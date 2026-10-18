/*
 * user faction overview
 */
import { useMemo, useState, useCallback, useRef } from 'preact/hooks';
import { Fragment } from 'preact';
import { useDispatch } from '../../store/react-redux/index.js';
import { t, jt } from 'ttag';

import {
  validateFactionName, validateFactionTitle, validateDescription,
} from '../../utils/validation.js';
import { cdn } from '../../utils/utag.js';
import { getUrlsFromMediaIdAndName } from '../../utils/media/utils.js';
import {
  changeProfile, changeUserFaction,
} from '../../store/actions/thunks.js';
import {
  requestCreateFaction, requestLeaveFaction,
} from '../../store/actions/fetch.js';
import {
  applyPatches,
} from '../../store/actions/index.js';
import FileUpload from '../FileUpload.jsx';
import useProfile from '../hooks/useProfile.js';
import useLink from '../hooks/link.js';

/* eslint-disable max-len */

const MyFactions = () => {
  const [selected, setSelected] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [page, setPage] = useState('list');
  const uploadRef = useRef();

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);

  const [factions, activeFactionRole, fetched] = useProfile((profile) => [
    profile.factions,
    profile.activeFactionRole,
  ]);
  const link = useLink();
  const dispatch = useDispatch();

  const changePage = useCallback((newPage) => () => {
    setSubmitting(false);
    setErrors([]);
    setPage(newPage);
  }, []);

  const [
    activeFaction,
    activeFactionTitle,
    activeRoleName,
    activeCustomFlagId,
  ] = useMemo(() => {
    if (factions?.length) {
      let retValue;
      for (let i = 0; i < factions.length; i += 1) {
        const { roles } = factions[i];
        for (let u = 0; u < roles.length; u += 1) {
          if (roles[u].frid === activeFactionRole) {
            retValue = [
              factions[i].name,
              // eslint-disable-next-line react/jsx-key
              <strong>&quot;{factions[i].title}&quot;</strong>,
              // eslint-disable-next-line react/jsx-key
              <strong>&quot;{roles[u].name}&quot;</strong>,
              roles[u].customFlagId,
            ];
            break;
          }
        }
      }
      if (retValue) {
        return retValue;
      }
    }
    return [null, '', '', null];
  }, [factions, activeFactionRole]);

  const setActiveRole = useCallback(async (gActiveFactionRole) => {
    const respErrors = await dispatch(
      changeProfile({ activeFactionRole: gActiveFactionRole }),
    );
    setErrors((oErrors) => {
      if (respErrors.length) {
        return respErrors;
      }
      return oErrors.length ? [] : oErrors;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFactionHidden = useCallback(async (factionName, isHidden) => {
    const respErrors = await dispatch(
      changeUserFaction({ factionName, isHidden }),
    );
    setErrors((oErrors) => {
      if (respErrors.length) {
        return respErrors;
      }
      return oErrors.length ? [] : oErrors;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitCreateFaction = useCallback(async (evt) => {
    evt.preventDefault();
    if (submitting) {
      return;
    }
    const name = evt.target.name.value;
    const title = evt.target.title.value;
    const description = evt.target.description.value;
    const isPrivate = evt.target.isprivate.checked;
    const isPublic = evt.target.ispublic.checked;

    const valErrors = [];
    let error = validateFactionName(name);
    if (error) valErrors.push(error);
    error = validateFactionTitle(title);
    if (error) valErrors.push(error);
    error = validateDescription(description);
    if (error) valErrors.push(error);
    if (valErrors.length) {
      setErrors(valErrors);
      return;
    }

    setSubmitting(true);
    const files = await uploadRef.current?.();
    if (files.length !== 1) {
      setErrors([t`You must select an avatar for your faction`]);
    } else {
      const avatarId = files[0].mediaId;
      const {
        errors: respErrors, patches,
      } = await requestCreateFaction(
        name, title, description, isPrivate, isPublic, avatarId,
      );
      if (patches) {
        dispatch(applyPatches(patches));
      }
      if (respErrors) {
        setErrors(respErrors);
      } else {
        setErrors([]);
        setPage('list');
      }
    }
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting]);

  const submitLeaveFaction = useCallback(async (factionName) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    const {
      errors: respErrors, patches,
    } = await requestLeaveFaction(factionName);
    if (patches) {
      dispatch(applyPatches(patches));
    }
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setSelected(null);
    }
    setConfirmLeave(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting]);

  if (!fetched) {
    return (<div className="content" key="loading"><h3>{t`Loading...`}</h3></div>);
  }

  if (page === 'create') {
    return (
      <div className="content" key="create">
        <h2>{t`Create Faction`}</h2>
        <form onSubmit={submitCreateFaction} className="client-form">
          <div className="form-group">
            <label>{t`Name`}:
              <input
                type="text"
                name="name"
                placeholder="Name"
                required
              /></label>
            <small>{t`Name of your faction (this can not be changed later)`} [a-z][A-Z][0-9].-_</small>
          </div>

          <div className="form-group form-group-avatar">
            <span>{t`Avatar`}:
              <FileUpload
                acceptedTypes="image/*"
                keepFile
                maxFiles={1}
                uploadRef={uploadRef}
                size={60}
              /></span>
            <small>{t`An image representing your faction`}</small>
          </div>

          <div className="form-group">
            <label htmlFor="title">{t`Title`}:
              <input
                type="text"
                name="title"
                placeholder="title"
                required
              /></label>
            <small>{t`Title of your faction`}</small>
          </div>

          <div className="form-group">
            <label>{t`Description`}:
              <textarea
                name="description"
                placeholder={t`Enter a little text that describes your faction`}
                rows="3"
                required
              /></label>
            <small>{t`Description of your faction`}</small>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="isprivate"
                defaultChecked={false}
              />
              <span className="checkmark" />
              {t`Don't show faction in search`}
            </label>
            <small>{t`Don't let people find this faction in public search or look at its profile.`}</small>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="ispublic"
                defaultChecked={false}
              />
              <span className="checkmark" />
              {t`Let everyone join this faction`}
            </label>
            <small>{t`Let people join this faction without needing an invite.`}</small>
          </div>

          {errors.map((error) => (
            <p key={error} className="errormessage">
              <span>{t`Error`}</span>:&nbsp;{error}</p>
          ))}
          <div className="form-actions">
            <button
              type="submit"
              disabled={submitting}
            >
              {t`Submit`}
            </button>
            <button
              type="button"
              onClick={changePage('list')}
            >
              {t`Cancel`}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="content" key="list">
      <h2>{t`Your Factions`}</h2>
      {errors.map((error) => (
        <p key={error} className="errormessage">
          <span>{t`Error`}</span>:&nbsp;{error}</p>
      ))}
      {(factions.length > 0) ? (
        <Fragment key="fl">
          {(activeFaction) ? (
            <p key="pres">
              {jt`You are currently representing ${activeFactionTitle} as ${activeRoleName}`}
              {(activeCustomFlagId) && (
                <img
                  className="chatflag"
                  src={cdn`${getUrlsFromMediaIdAndName(activeCustomFlagId)[0]}`}
                  alt=""
                />
              )}.&nbsp;
              <span
                role="button"
                tabIndex={-1}
                className="modallink"
                onClick={() => setActiveRole(null)}
              >
                {t`Click here to cease representation.`}
              </span>
            </p>
          ) : (
            <p key="pres">{t`You are currently not representing any faction. To represent one, activate a role in one of your factions below.`}</p>
          )}
          <div className="factionlist">{factions.map((faction) => {
            const { name } = faction;
            let titleClass = 'factionlist-title';
            if (name === activeFaction) {
              titleClass += ' active';
            }
            if (faction.isHidden) {
              titleClass += ' hidden';
            }
            const [, thumb] = getUrlsFromMediaIdAndName(faction.avatarId, 'avatar');
            /* determine highest user powerlvl */
            let powerlvl = 0;
            for (const role of faction.roles) {
              if (role.isMember && role.factionlvl > powerlvl) {
                powerlvl = role.factionlvl;
              }
            }
            if (powerlvl >= 100) {
              powerlvl = 'sovereign';
            } else if (powerlvl >= 80) {
              powerlvl = 'magistrate';
            } else if (powerlvl >= 50) {
              powerlvl = 'noble';
            } else {
              powerlvl = 'peasant';
            }

            const item = (
              <div
                key={faction.name}
                className="factionlist-item"
                onClick={() => {
                  if (name === selected) {
                    setSelected(null);
                  } else {
                    setSelected(name);
                  }
                  setErrors([]);
                  setConfirmLeave(false);
                }}
                role="button"
                tabIndex={0}
              >
                {(thumb) && (
                  <img
                    src={cdn`${thumb}`}
                    loading="lazy"
                    className="factionlist-avatar"
                    alt=""
                  />
                )}
                <span className={`factionlist-square powerlvl-${powerlvl}`} />
                <span className={titleClass}>{faction.title}</span>
                <span className="factionlist-name">[{faction.name}]</span>
                <span className="factionlist-membercount">{faction.memberCount}</span>
              </div>
            );

            if (name === selected) {
              return (
                <div
                  key={`edit-${faction.name}`}
                >
                  {item}
                  <div className="factionlist-edit">
                    <span className="factionlist-key">{t`Description`}: </span>{faction.description}<br />
                    {(faction.roles.length > 0) && (
                      <Fragment key="role-list">
                        <span className="factionlist-key">{t`Your Roles`}: </span>
                        {faction.roles.filter((role) => role.isMember).map((role) => {
                          const [flagUrl] = getUrlsFromMediaIdAndName(role.customFlagId);
                          let roleClassName = 'factionlist-role';
                          if (role.frid === activeFactionRole) {
                            roleClassName += ' active';
                          }
                          const { factionlvl } = role;
                          if (factionlvl >= 100) {
                            roleClassName += ' powerlvl-sovereign';
                          } else if (factionlvl >= 80) {
                            roleClassName += ' powerlvl-magistrate';
                          } else if (factionlvl >= 50) {
                            roleClassName += ' powerlvl-noble';
                          } else {
                            roleClassName += ' powerlvl-peasant';
                          }
                          return (
                            <span
                              key={role.frid}
                              role="button"
                              tabIndex={-1}
                              className={roleClassName}
                              onClick={() => setActiveRole(role.frid)}
                            >
                              {(flagUrl) && (
                                <img
                                  className="chatflag"
                                  src={cdn`${flagUrl}`}
                                  alt=""
                                />
                              )} {role.name}
                            </span>
                          );
                        })}<br />
                        <span className="factionlist-key">{t`(click a role to activate it)`}</span><br />
                      </Fragment>
                    )}
                    <input
                      type="checkbox"
                      checked={faction.isHidden}
                      onChange={(evt) => {
                        setFactionHidden(faction.name, evt.target.checked);
                      }}
                    /> {t`Hide from profile`}
                    <div className="form-actions">
                      <button
                        type="button"
                        className={confirmLeave ? 'confirm' : undefined}
                        onClick={() => {
                          if (!confirmLeave) {
                            setConfirmLeave(true);
                            return;
                          }
                          submitLeaveFaction(faction.name);
                        }}
                      >
                        {/* t: button for leaving a faction, it asks for confirmation */}
                        {(confirmLeave) ? t`Confirm Leave` : t`Leave`}
                      </button>
                      <button
                        type="button"
                        onClick={(evt) => {
                          evt.stopPropagation();
                          link('FACTION', {
                            target: 'parent',
                            args: { name: faction.name },
                          });
                        }}
                      >
                        {t`Open`}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(null);
                          setErrors([]);
                          setConfirmLeave(false);
                        }}
                      >
                        {t`Close`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return item;
          })}</div>
        </Fragment>
      ) : (
        <p key="nofl">{t`You are currently not a member of any faction.`}</p>
      )}
      <p>{t`Factions allow you to coordinate better with other players. Search for existing factions, find friends or create your own faction.`}</p>
      <div className="form-actions">
        <button
          type="button"
          onClick={(evt) => {
            evt.stopPropagation();
            link('SEARCH', {
              args: { activeTab: 'factions' },
            });
          }}
        >
          {t`Search Existing Faction`}
        </button>
        <button
          type="button"
          onClick={changePage('create')}
        >
          {t`Create New Faction`}
        </button>
      </div>
    </div>
  );
};

export default MyFactions;
