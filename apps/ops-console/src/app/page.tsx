import Link from 'next/link';
import { dataSource } from '../data-source/FixtureDataSource';
import { DeploymentViewModel } from '../view-models/DeploymentViewModel';

export default async function DeploymentsPage() {
  const records = await dataSource.listDeployments();
  const deployments = await Promise.all(records.map(async (r) => {
    const events = await dataSource.getDeploymentEvents(r.deploymentId);
    return new DeploymentViewModel(r, events);
  }));

  return (
    <div>
      <h2>Deployment Registry</h2>
      
      {deployments.length === 0 ? (
        <div className="empty-state">
          <p>No deployments found.</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Client ID</th>
                <th>Delivery Mode</th>
                <th>Status</th>
                <th>Health</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map(dep => (
                <tr key={dep.id}>
                  <td>{dep.id}</td>
                  <td>{dep.clientId}</td>
                  <td>{dep.deliveryMode}</td>
                  <td>
                    <span className={`badge ${dep.isHandoffCompleted ? 'success' : ''}`}>
                      {dep.statusBadge}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${dep.health}`}>
                      {dep.health}
                    </span>
                  </td>
                  <td>
                    <Link href={`/deployments/${dep.id}`} className="btn">
                      View Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
