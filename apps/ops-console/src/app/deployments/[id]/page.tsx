import { notFound } from 'next/navigation';
import { dataSource } from '../../../data-source/FixtureDataSource';
import { DeploymentViewModel } from '../../../view-models/DeploymentViewModel';
import { TechnicalAuditTimeline } from '../../../components/TechnicalAuditTimeline';

export default async function DeploymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await dataSource.getDeployment(id);
  
  if (!record) {
    notFound();
  }

  const events = await dataSource.getDeploymentEvents(id);
  const deployment = new DeploymentViewModel(record, events);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Deployment: {deployment.id}</h2>
        <div>
          <span className={`badge ${deployment.isHandoffCompleted ? 'success' : ''}`} style={{ marginRight: '0.5rem' }}>
            {deployment.statusBadge}
          </span>
          <span className={`badge ${deployment.health}`}>
            Health: {deployment.health}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>Configuration Details</h3>
        <table className="table">
          <tbody>
            <tr>
              <th>Configuration Version</th>
              <td>{deployment.raw.websiteConfigurationId}</td>
            </tr>
            <tr>
              <th>Delivery Mode</th>
              <td>{deployment.deliveryMode}</td>
            </tr>
            <tr>
              <th>Handoff Status</th>
              <td>{deployment.raw.handoff?.status || 'None'}</td>
            </tr>
            <tr>
              <th>Domain Owner</th>
              <td>{deployment.raw.domainOwner}</td>
            </tr>
            <tr>
              <th>Operational Owner</th>
              <td>{deployment.raw.operationalOwner}</td>
            </tr>
            <tr>
              <th>Hosting Owner</th>
              <td>{deployment.raw.hostingAccountOwner}</td>
            </tr>
            <tr>
              <th>Source Repo Owner</th>
              <td>{deployment.raw.sourceRepositoryOwner}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Technical Audit Timeline</h3>
        {events.length === 0 ? (
          <p>No events found for this deployment.</p>
        ) : (
          <TechnicalAuditTimeline events={events} />
        )}
      </div>
    </div>
  );
}
