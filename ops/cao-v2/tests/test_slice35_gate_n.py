"""Gate N - synthetic multi-project and continuity isolation.

Three projects are constructed to collide on everything that is *not* the
isolation boundary: identical task IDs, identical Command IDs, identical
approval request IDs, identical recipes and identical skill bytes.  If isolation
were implemented by naming convention rather than structurally, these tests
would pass by accident; because the collisions are exact, they cannot.

The skill cache is deliberately shared across all three projects so that content
deduplication is exercised at the same time as binding separation.  Sharing
bytes is safe; sharing authorization is not.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.approval import (
    APPROVED,
    AUTHORITY_OPERATOR,
    AUTHORITY_SUPERVISOR,
    ESCALATED_FOR_AUTHORITY,
    WAITING_FOR_APPROVAL,
    ApprovalBindingError,
    namespace_key,
    new_approval_application,
    worker_health_state,
)
from mlgo_cao_v2.approval_broker import (
    CLASS_PRODUCTION_AUTHORITY,
    ApprovalBroker,
    ApprovalStore,
)
from mlgo_cao_v2.common import PolicyError, append_jsonl, sha256_json
from mlgo_cao_v2.events import SOURCE_RUN_STORE, EventProjection, make_event_intent
from mlgo_cao_v2.skill_cache import SealedSkillCache, SkillCacheIsolationError
from mlgo_cao_v2.skill_recipes import compile_skill_contract

import slice35_fixtures as fx


class Slice35GateNTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        # One shared cache: dedup is expected and safe.
        self.cache = SealedSkillCache(self.root)
        self.manifests = fx.seal_all(self.cache)
        self.registry = fx.build_registry(self.manifests)
        self.projects = list(zip(fx.PROJECTS, fx.DOMAINS))
        for project_id, domain_id in self.projects:
            fx.bind_all(self.cache, project_id=project_id, security_domain_id=domain_id)
        self.addCleanup(self._tmp.cleanup)

    def store_for(self, index: int) -> ApprovalStore:
        project_id, domain_id = self.projects[index]
        return ApprovalStore(
            self.root, project_id=project_id, security_domain_id=domain_id
        )

    def broker_for(self, index: int) -> ApprovalBroker:
        return ApprovalBroker(self.store_for(index), **fx.delegated_broker_args())

    def colliding_intent(self, index: int, **overrides):
        project_id, domain_id = self.projects[index]
        kwargs = dict(
            approval_request_id="req-shared",
            project_id=project_id,
            security_domain_id=domain_id,
            command_id="cmd-shared",
            task_id="task-shared",
        )
        kwargs.update(overrides)
        return fx.an_intent(**kwargs)

    def contract_for(self, index: int):
        project_id, domain_id = self.projects[index]
        return compile_skill_contract(
            registry=self.registry,
            cache=self.cache,
            recipe=fx.implementation_recipe(),
            project_id=project_id,
            security_domain_id=domain_id,
            role="developer",
            task_class="implementation",
            risk_class="standard",
        )

    # -- N-01 ------------------------------------------------------------

    def test_N01_three_colliding_projects_leak_no_approval_decisions(self):
        decisions = []
        for index in range(3):
            store = self.store_for(index)
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intent = self.colliding_intent(index)
            store.open_request(intent)
            decisions.append(
                broker.evaluate(
                    intent,
                    decision_id="dec-shared",
                    owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                    current_pre_state_digest=fx.PRE_STATE_DIGEST,
                )
            )

        # Every namespace key differs even though every ID is identical.
        namespaces = {d["namespace_key"] for d in decisions}
        self.assertEqual(len(namespaces), 3)
        digests = {d["decision_digest"] for d in decisions}
        self.assertEqual(len(digests), 3)

        # Each store sees exactly its own decision.
        for index in range(3):
            store = self.store_for(index)
            own = store.list_decisions()
            self.assertEqual(len(own), 1)
            self.assertEqual(own[0]["namespace_key"], decisions[index]["namespace_key"])
            self.assertEqual(own[0]["project_id"], self.projects[index][0])

    def test_N01_project_and_domain_are_each_independently_part_of_the_boundary(self):
        # The three headline projects vary project *and* domain together, which
        # would let an implementation that ignored one of them still look
        # isolated.  These pairs vary exactly one axis at a time.
        same_domain_different_projects = (
            namespace_key(project_id="project-alpha", security_domain_id="domain-shared"),
            namespace_key(project_id="project-beta", security_domain_id="domain-shared"),
        )
        self.assertNotEqual(
            *same_domain_different_projects,
            msg="two projects inside one security domain share a namespace",
        )
        same_project_different_domains = (
            namespace_key(project_id="project-shared", security_domain_id="domain-alpha"),
            namespace_key(project_id="project-shared", security_domain_id="domain-beta"),
        )
        self.assertNotEqual(
            *same_project_different_domains,
            msg="one project across two security domains shares a namespace",
        )

    def test_N01_two_projects_in_one_domain_cannot_share_an_approval_decision(self):
        shared_domain = "domain-shared"
        store_a = ApprovalStore(
            self.root, project_id="project-alpha", security_domain_id=shared_domain
        )
        store_b = ApprovalStore(
            self.root, project_id="project-beta", security_domain_id=shared_domain
        )
        broker_a = ApprovalBroker(store_a, **fx.delegated_broker_args())
        intent_a = fx.an_intent(
            approval_request_id="req-shared",
            project_id="project-alpha",
            security_domain_id=shared_domain,
            command_id="cmd-shared",
            task_id="task-shared",
        )
        store_a.open_request(intent_a)
        decision_a = broker_a.evaluate(
            intent_a,
            decision_id="dec-shared",
            owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
            current_pre_state_digest=fx.PRE_STATE_DIGEST,
        )
        self.assertNotEqual(store_a.namespace_key, store_b.namespace_key)
        with self.assertRaises(PolicyError) as ctx:
            store_b.record_decision(
                {k: v for k, v in decision_a.items() if k != "duplicate"}
            )
        self.assertIn("belongs to namespace", str(ctx.exception))
        self.assertIsNone(store_b.load_decision("dec-shared"))

    def test_N01_one_project_across_two_domains_cannot_share_a_skill_binding(self):
        cache = SealedSkillCache(self.root / "axis-probe")
        fx.seal_all(cache)
        cache.bind_bundle(
            bundle_id="bundle-engineering",
            project_id="project-shared",
            security_domain_id="domain-alpha",
        )
        cache.resolve(
            bundle_id="bundle-engineering",
            project_id="project-shared",
            security_domain_id="domain-alpha",
        )
        with self.assertRaises(SkillCacheIsolationError):
            cache.resolve(
                bundle_id="bundle-engineering",
                project_id="project-shared",
                security_domain_id="domain-beta",
            )

    def test_N01_two_projects_in_one_domain_cannot_share_a_skill_binding(self):
        cache = SealedSkillCache(self.root / "axis-probe-2")
        fx.seal_all(cache)
        cache.bind_bundle(
            bundle_id="bundle-engineering",
            project_id="project-alpha",
            security_domain_id="domain-shared",
        )
        with self.assertRaises(SkillCacheIsolationError):
            cache.resolve(
                bundle_id="bundle-engineering",
                project_id="project-beta",
                security_domain_id="domain-shared",
            )

    def test_N01_a_foreign_decision_cannot_be_written_into_another_namespace(self):
        store_a, store_b = self.store_for(0), self.store_for(1)
        broker_a = ApprovalBroker(store_a, **fx.delegated_broker_args())
        intent_a = self.colliding_intent(0)
        store_a.open_request(intent_a)
        decision_a = broker_a.evaluate(
            intent_a,
            decision_id="dec-shared",
            owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
            current_pre_state_digest=fx.PRE_STATE_DIGEST,
        )
        with self.assertRaises(PolicyError) as ctx:
            store_b.record_decision(
                {k: v for k, v in decision_a.items() if k != "duplicate"}
            )
        self.assertIn("belongs to namespace", str(ctx.exception))
        self.assertIsNone(store_b.load_decision("dec-shared"))

    # -- N-02 ------------------------------------------------------------

    def test_N02_identical_recipes_dedup_content_but_keep_bindings_separate(self):
        contracts = [self.contract_for(i) for i in range(3)]

        # The selected skill bytes are literally the same objects.
        digest_sets = [
            {s["content_digest"] for s in c["selected_skills"]} for c in contracts
        ]
        self.assertEqual(digest_sets[0], digest_sets[1])
        self.assertEqual(digest_sets[1], digest_sets[2])

        # But each contract binds its own project and security domain, so the
        # contract digests - which approvals bind to - are all distinct.
        self.assertEqual(
            len({c["skill_contract_digest"] for c in contracts}), 3
        )
        for index, contract in enumerate(contracts):
            self.assertEqual(contract["project_id"], self.projects[index][0])
            self.assertEqual(contract["security_domain_id"], self.projects[index][1])

    def test_N02_one_stored_object_backs_all_three_projects(self):
        objects = sorted(p.name for p in self.cache.objects_dir.rglob("*") if p.is_file())
        total_files = sum(
            len(m["file_manifest"]) for m in self.manifests.values()
        )
        # Content-addressed storage keeps exactly one object per distinct file
        # no matter how many namespaces bind it.
        self.assertEqual(len(objects), total_files)
        self.assertEqual(len(objects), len(set(objects)))

    # -- N-03 ------------------------------------------------------------

    def test_N03_cross_domain_skill_reference_fails_closed(self):
        isolated = SealedSkillCache(self.root / "isolated")
        fx.seal_all(isolated)
        isolated.bind_bundle(
            bundle_id="bundle-security-pack",
            project_id=self.projects[0][0],
            security_domain_id=self.projects[0][1],
        )
        with self.assertRaises(SkillCacheIsolationError) as ctx:
            isolated.resolve(
                bundle_id="bundle-security-pack",
                project_id=self.projects[1][0],
                security_domain_id=self.projects[1][1],
            )
        message = str(ctx.exception)
        self.assertIn("is not available in project", message)

    def test_N03_an_unbound_bundle_does_not_disclose_whether_its_bytes_exist(self):
        isolated = SealedSkillCache(self.root / "leak-probe")
        fx.seal_all(isolated)

        def failure_for(bundle_id):
            try:
                isolated.resolve(
                    bundle_id=bundle_id,
                    project_id=self.projects[2][0],
                    security_domain_id=self.projects[2][1],
                )
            except SkillCacheIsolationError as exc:
                return str(exc)
            raise AssertionError("resolve unexpectedly succeeded")

        sealed_but_unbound = failure_for("bundle-security-pack")
        never_sealed = failure_for("bundle-that-never-existed")
        # The two messages differ only by the bundle id the caller already knew,
        # so the error cannot be used as an existence oracle.
        self.assertEqual(
            sealed_but_unbound.replace("bundle-security-pack", "X"),
            never_sealed.replace("bundle-that-never-existed", "X"),
        )

    def test_N03_cross_domain_approval_reference_fails_closed(self):
        store_a, store_b = self.store_for(0), self.store_for(1)
        broker_b = ApprovalBroker(store_b, **fx.delegated_broker_args())
        intent_a = self.colliding_intent(0)
        store_a.open_request(intent_a)
        with self.assertRaises(PolicyError):
            store_b.open_request(intent_a)
        with self.assertRaises(PolicyError):
            broker_b.evaluate(
                intent_a,
                decision_id="dec-foreign",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )

    # -- N-04 ------------------------------------------------------------

    def test_N04_restart_reconstructs_pending_approvals_and_contracts_exactly(self):
        original_contracts = []
        for index in range(3):
            store = self.store_for(index)
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intent = self.colliding_intent(index)
            store.open_request(intent)
            decision = broker.evaluate(
                intent,
                decision_id="dec-shared",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )
            store.record_application(
                new_approval_application(
                    application_id="app-shared",
                    decision=decision,
                    adapter_id="adapter-fixture",
                    provider_profile_id="profile-fixture",
                    observed_state=WAITING_FOR_APPROVAL,
                )
            )
            original_contracts.append(self.contract_for(index))

        # Restart: brand-new cache, registry and store objects over the same bytes.
        restarted_cache = SealedSkillCache(self.root)
        restarted_registry = fx.build_registry(
            {b: restarted_cache.load_manifest(b) for b in self.manifests}
        )
        for index in range(3):
            project_id, domain_id = self.projects[index]
            store = ApprovalStore(
                self.root, project_id=project_id, security_domain_id=domain_id
            )
            pending = store.pending_requests()
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["project_id"], project_id)
            rebuilt = compile_skill_contract(
                registry=restarted_registry,
                cache=restarted_cache,
                recipe=fx.implementation_recipe(),
                project_id=project_id,
                security_domain_id=domain_id,
                role="developer",
                task_class="implementation",
                risk_class="standard",
            )
            self.assertEqual(
                rebuilt["skill_contract_digest"],
                original_contracts[index]["skill_contract_digest"],
            )

    # -- N-05 ------------------------------------------------------------

    def test_N05_one_project_waiting_leaves_the_other_two_runnable(self):
        applications = {}
        for index in range(3):
            store = self.store_for(index)
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intent = self.colliding_intent(index)
            store.open_request(intent)
            decision = broker.evaluate(
                intent,
                decision_id="dec-shared",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )
            state = WAITING_FOR_APPROVAL if index == 1 else APPROVED
            applications[index] = new_approval_application(
                application_id="app-shared",
                decision=decision,
                adapter_id="adapter-fixture",
                provider_profile_id="profile-fixture",
                observed_state=state,
            )
            store.record_application(applications[index])

        health = {
            index: worker_health_state(
                applications=[applications[index]], execution_progressing=True
            )
            for index in range(3)
        }
        self.assertEqual(health[1]["state"], WAITING_FOR_APPROVAL)
        self.assertFalse(health[1]["running"])
        for index in (0, 2):
            self.assertEqual(health[index]["state"], "RUNNING", index)
            self.assertTrue(health[index]["running"], index)

    # -- N-06 ------------------------------------------------------------

    def test_N06_a_stale_decision_blocks_only_its_own_project(self):
        decisions, intents = {}, {}
        for index in range(3):
            store = self.store_for(index)
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intents[index] = self.colliding_intent(index)
            store.open_request(intents[index])
            decisions[index] = broker.evaluate(
                intents[index],
                decision_id="dec-shared",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )

        # Project index 1's pre-state moves; the others are untouched.
        moved = sha256_json({"head": "d" * 40})
        with self.assertRaises(ApprovalBindingError):
            self.broker_for(1).prepare_application(
                intent=intents[1],
                decision=decisions[1],
                current=fx.current_context(
                    intents[1], expected_pre_state_digest=moved
                ),
            )
        for index in (0, 2):
            report = self.broker_for(index).prepare_application(
                intent=intents[index],
                decision=decisions[index],
                current=fx.current_context(intents[index]),
            )
            self.assertTrue(report["ok"], index)

    # -- N-07 ------------------------------------------------------------

    def test_N07_an_authority_decision_cannot_satisfy_another_projects_escalation(self):
        escalations = {}
        for index in (0, 1):
            store = self.store_for(index)
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intent = self.colliding_intent(
                index, operation_class=CLASS_PRODUCTION_AUTHORITY
            )
            store.open_request(intent)
            escalations[index] = broker.evaluate(
                intent,
                decision_id="dec-shared",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )
            self.assertEqual(escalations[index]["outcome"], ESCALATED_FOR_AUTHORITY)

        # Project 0's broker refuses to close project 1's escalation.
        with self.assertRaises(PolicyError) as ctx:
            self.broker_for(0).close_escalation(
                decision=escalations[1], answering_authority_class=AUTHORITY_OPERATOR
            )
        self.assertIn("belongs to namespace", str(ctx.exception))

        # And even inside the right namespace, a weaker authority cannot close it.
        with self.assertRaises(PolicyError):
            self.broker_for(1).close_escalation(
                decision=escalations[1], answering_authority_class=AUTHORITY_SUPERVISOR
            )

    # -- N-08 ------------------------------------------------------------

    def test_N08_event_projection_rebuild_is_digest_equivalent_per_project(self):
        # Approval and skill facts are projected through the existing Slice 3
        # Event stream rather than a second ledger: each fact's intent is
        # embedded in the owner-ledger journal record that commits it.
        digests = {}
        for index in range(3):
            project_id, domain_id = self.projects[index]
            run_dir = self.root / "runs" / project_id / "v2"
            run_dir.mkdir(parents=True, exist_ok=True)

            store = self.store_for(index)
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intent = self.colliding_intent(index)
            store.open_request(intent)
            decision = broker.evaluate(
                intent,
                decision_id="dec-shared",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )
            contract = self.contract_for(index)

            for state_version, (event_type, payload) in enumerate(
                (
                    (
                        "approval.decision_recorded",
                        {
                            "approval_request_id": intent["approval_request_id"],
                            "decision_id": decision["decision_id"],
                            "outcome": decision["outcome"],
                            "namespace_key": decision["namespace_key"],
                            "request_digest": decision["request_digest"],
                        },
                    ),
                    (
                        "skill.contract_compiled",
                        {
                            "skill_contract_digest": contract["skill_contract_digest"],
                            "registry_revision": contract["registry_revision"],
                            "namespace_key": namespace_key(
                                project_id=project_id, security_domain_id=domain_id
                            ),
                        },
                    ),
                ),
                start=1,
            ):
                append_jsonl(
                    run_dir / "journal.jsonl",
                    {
                        "state_version": state_version,
                        "transaction_id": f"tx-{state_version}",
                        "event_outbox": [
                            make_event_intent(
                                source=SOURCE_RUN_STORE,
                                run_id=intent["run_id"],
                                cursor_token=f"{project_id}:{state_version}",
                                event_type=event_type,
                                discriminator=event_type,
                                payload=payload,
                                causation_id=intent["command_id"],
                            )
                        ],
                    },
                )

            projection = EventProjection(run_dir, run_id=intent["run_id"])
            projection.project()
            before = projection.canonical_stream_digest()
            rebuilt = EventProjection(run_dir, run_id=intent["run_id"]).rebuild()
            after = rebuilt["checkpoint"]["canonical_stream_digest"]
            self.assertEqual(before, after, project_id)
            digests[project_id] = before

        # Each project's projected stream is distinct despite identical event
        # types, run IDs and Command IDs.
        self.assertEqual(len(set(digests.values())), 3)

    def test_N08_projected_approval_events_carry_their_namespace(self):
        project_id, domain_id = self.projects[0]
        run_dir = self.root / "runs" / "n08b" / "v2"
        run_dir.mkdir(parents=True, exist_ok=True)
        store = self.store_for(0)
        broker = ApprovalBroker(store, **fx.delegated_broker_args())
        intent = self.colliding_intent(0)
        store.open_request(intent)
        decision = broker.evaluate(
            intent,
            decision_id="dec-shared",
            owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
            current_pre_state_digest=fx.PRE_STATE_DIGEST,
        )
        append_jsonl(
            run_dir / "journal.jsonl",
            {
                "state_version": 1,
                "transaction_id": "tx-1",
                "event_outbox": [
                    make_event_intent(
                        source=SOURCE_RUN_STORE,
                        run_id=intent["run_id"],
                        cursor_token="n08b:1",
                        event_type="approval.decision_recorded",
                        discriminator="approval.decision_recorded",
                        payload={"namespace_key": decision["namespace_key"]},
                    )
                ],
            },
        )
        projection = EventProjection(run_dir, run_id=intent["run_id"])
        projection.project()
        events = projection.load_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(
            events[0]["payload"]["namespace_key"],
            namespace_key(project_id=project_id, security_domain_id=domain_id),
        )
        self.assertTrue(projection.verify()["ok"])


if __name__ == "__main__":
    unittest.main()
