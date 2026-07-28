import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="error-state">
      <h2>Not Found</h2>
      <p>The requested resource could not be found.</p>
      <Link href="/" className="btn" style={{ marginTop: '1rem' }}>
        Return Home
      </Link>
    </div>
  );
}
