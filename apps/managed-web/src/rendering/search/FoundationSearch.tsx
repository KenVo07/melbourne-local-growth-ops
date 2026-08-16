export interface FoundationSearchProps {
  readonly businessName: string;
}

/**
 * Server-rendered search shell. Its isolated controller is emitted only by an
 * enabled Foundation Search build, so disabled sites receive no search chunk.
 */
export function FoundationSearch({ businessName }: FoundationSearchProps) {
  return (
    <section className="foundation-search-slot" data-foundation-search="">
      <button
        aria-haspopup="dialog"
        className="foundation-search-trigger"
        data-foundation-search-open=""
        type="button"
      >
        Search this website
      </button>
      <dialog
        aria-labelledby="foundation-search-title"
        className="foundation-search-dialog"
        data-foundation-search-dialog=""
      >
        <form className="foundation-search-heading" method="dialog">
          <div>
            <p className="site-eyebrow">Foundation Search</p>
            <h2 id="foundation-search-title">Search {businessName}</h2>
          </div>
          <button type="submit" value="close">Close search</button>
        </form>
        <form data-foundation-search-form="" role="search">
          <label htmlFor="foundation-search-query">
            Search public website content
          </label>
          <div className="foundation-search-controls">
            <input
              autoComplete="off"
              data-foundation-search-query=""
              id="foundation-search-query"
              name="query"
              type="search"
            />
            <button data-foundation-search-submit="" type="submit">
              Search
            </button>
          </div>
        </form>
        <p
          aria-live="polite"
          className="foundation-search-status"
          data-foundation-search-status=""
          role="status"
        >
          Enter a word or phrase to search this website.
        </p>
        <ul
          className="foundation-search-results"
          data-foundation-search-results=""
        />
      </dialog>
      <script src="/pagefind/foundation-search.js" type="module" />
    </section>
  );
}
