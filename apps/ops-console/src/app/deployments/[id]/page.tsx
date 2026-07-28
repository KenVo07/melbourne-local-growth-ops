import { notFound } from 'next/navigation';
import { dataSource } from '../../../data-source/FixtureDataSource';
import { DeploymentViewModel } from '../../../view-models/DeploymentViewModel';

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

  const deployment = new DeploymentViewModel(record);
  const events = await dataSource.getDeploymentEvents(id);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Deployment: {deployment.id}</h2>
        <span className={`badge ${deployment.isHandoffCompleted ? 'success' : ''}`}>
          {deployment.statusBadge}
        </span>
      </div>

      <div className="card">
        <h3>Configuration Details</h3>
        <table className="table">
          <tbody>
            <tr>
              <th>Client ID</th>
              <td>{deployment.clientId}</td>
            </tr>
            <tr>
              <th>Delivery Mode</th>
              <td>{deployment.deliveryMode}</td>
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
        <h3>Technical Event Inspector</h3>
        {events.length === 0 ? (
          <p>No events found for this deployment.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Event ID</th>
              </tr>
            </thead>
            <tbody>
              {events.map(evt => (
                <tr key={evt.id}>
                  <td>{new Date(evt.timestamp).toLocaleString()}</td>
                  <td>{evt.type}</td>
                  <td>{evt.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
