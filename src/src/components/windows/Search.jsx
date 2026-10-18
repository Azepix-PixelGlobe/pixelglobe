/*
 * Search for users and factions
 */
import { useState, useContext, useCallback } from 'preact/hooks';
import { Fragment } from 'preact';
import { t } from 'ttag';

import WindowContext from '../context/window.js';
import { requestSearch } from '../../store/actions/fetch.js';
import Table from '../Table.jsx';

const Search = () => {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [results, setResults] = useState(null);

  const {
    args,
    setArgs,
    setTitle,
  } = useContext(WindowContext);
  const { activeTab = 'users' } = args;

  const tabNames = {
    users: t`Users`,
    factions: t`Factions`,
  };

  const setActiveTab = useCallback((tab) => {
    setArgs({
      activeTab: tab,
    });
    setTitle(tabNames[tab]);
    setResults(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setArgs, setTitle]);

  const submitSearch = useCallback(async (evt) => {
    evt.preventDefault();
    const term = evt.target.term.value;
    if (!term || term.trim() === '') {
      return;
    }
    setSubmitting(true);
    const reqSearchResults = await requestSearch(activeTab, term);
    setSubmitting(false);
    if (reqSearchResults.errors) {
      setErrors(reqSearchResults.errors);
      return;
    }
    setResults(reqSearchResults);
  }, [activeTab]);

  const availableTabs = Object.keys(tabNames);

  return (
    <div className="content">
      <h2>{t`Search`}</h2>
      <div className="tab-container">
        {availableTabs.map((tab, ind) => (
          <Fragment key={tab}>
            <span
              role="button"
              tabIndex={-1}
              className={
                (activeTab === tab) ? 'modallink selected' : 'modallink'
              }
              onClick={() => setActiveTab(tab)}
            >{tabNames[tab]}</span>
            {(ind !== availableTabs.length - 1)
              && <span className="hdivider" />}
          </Fragment>
        ))}
        <div className="modaldivider" />
        {errors.map((error) => (
          <p key={error} className="errormessage">
            <span>{t`Error`}</span>:&nbsp;{error}</p>
        ))}
      </div>
      <form onSubmit={submitSearch} className="tab-container">
        <input
          type="text"
          name="term"
          placeholder={t`Search Term`}
          required
        />
        <button
          type="submit"
          disabled={submitting}
        >
          {t`Search`}
        </button>
      </form>
      {(results?.rows.length) ? (
        <Table
          rows={results.rows}
          columnIds={results.columnIds}
          types={results.types}
          uniqueColumnKey={results.uniqueColumnKey}
          sortColumnKey={1}
        />
      ) : (
        <p>{
          (results) ? t`No results.` : t`Enter search term and press Search.`
        }</p>
      )}
    </div>
  );
};

export default Search;
