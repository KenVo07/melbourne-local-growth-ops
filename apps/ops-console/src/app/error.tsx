'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="error-state">
      <h2>Something went wrong!</h2>
      <p>The data might be invalid or the service is temporarily unavailable.</p>
      <button
        className="btn"
        onClick={() => reset()}
        style={{ marginTop: '1rem' }}
      >
        Try again
      </button>
    </div>
  );
}
