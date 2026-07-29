"use client";

import React, { useState } from "react";
import type { ObservabilityEvent } from "@melbourne-local-growth-ops/observability";

export function TechnicalAuditTimeline({ events }: { events: ObservabilityEvent[] }) {
  const [filter, setFilter] = useState<string>("ALL");

  const categories = ["ALL", ...Array.from(new Set(events.map(e => e.category)))];

  const filteredEvents = filter === "ALL" ? events : events.filter(e => e.category === filter);

  // Sort events newest first
  const sortedEvents = [...filteredEvents].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div>
      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="category-filter" style={{ marginRight: "0.5rem" }}>Filter by Category:</label>
        <select
          id="category-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="form-control"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {sortedEvents.length === 0 ? (
        <p>No events found matching the filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Category</th>
              <th>Event Name</th>
              <th>Correlation ID</th>
            </tr>
          </thead>
          <tbody>
            {sortedEvents.map((evt, idx) => (
              <tr key={idx}>
                <td>{new Date(evt.timestamp).toLocaleString()}</td>
                <td>{evt.category}</td>
                <td>{evt.eventName}</td>
                <td>{evt.correlationId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
