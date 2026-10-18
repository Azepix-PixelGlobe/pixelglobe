/*
 * faction
 */
import {
  useState, useEffect, useContext, useCallback, useRef,
} from 'preact/hooks';
import { Fragment } from 'preact';
import { useDispatch } from '../../store/react-redux/index.js';
import { t } from 'ttag';
import RiSave3Line from '../../icons/RiSave3Line.svg';
import IoTrashOutline from '../../icons/IoTrashOutline.svg';
import IoIosRefresh from '../../icons/IoIosRefresh.svg';

import { cdn } from '../../utils/utag.js';
import { getUrlsFromMediaIdAndName } from '../../utils/media/utils.js';
import {
  validateFactionName,
  validateFactionTitle,
  validateDescription,
} from '../../utils/validation.js';
import WindowContext from '../context/window.js';
import {
  requestFactionInfo,
  requestFactionMembers,
  requestFactionBans,
  requestFactionInvites,
  requestLeaveFaction,
  requestJoinFaction,
  requestAddFactionRole,
  requestRemoveFactionRole,
  requestKickBanFactionMember,
  requestLiftFactionBan,
  requestFactionRoleCreate,
  requestFactionRoleDelete,
  requestDeleteFaction,
  requestFactionInviteCreate,
  requestFactionInviteDelete,
} from '../../store/actions/fetch.js';
import {
  changeFactionRole,
  changeFaction,
} from '../../store/actions/thunks.js';
import { applyPatches } from '../../store/actions/index.js';
import { FACTION_PERMISSIONS } from '../../core/constants.js';
import useLink from '../hooks/link.js';
import ClipboardCopyField from '../ClipboardCopyField.jsx';
import FileUpload from '../FileUpload.jsx';
import Stat from '../Stat.jsx';
import { buildPopUpUrl } from './popUpAvailable.js';

/* eslint-disable max-len */

const Faction = () => {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [errors, setErrors] = useState([]);
  /* { faction, powerlvl, myUid } */
  const [factionData, setFactionData] = useState(null);
  /*
   * [{
   *   uid,
   *   name,
   *   username,
   *   avatarId,
   *   roles: [frid1, frid2, ...],
   * }, ...]
   */
  const [memberData, setMemberData] = useState(null);
  const [banData, setBanData] = useState(null);
  const [inviteData, setInviteData] = useState(null);

  const {
    args: { activeTab = 'overview', name },
    setArgs,
    setTitle,
  } = useContext(WindowContext);

  const uploadRef = useRef();
  const link = useLink();
  const dispatch = useDispatch();

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const tabNames = {
    overview: t`Overview`,
    members: t`Members`,
    bans: t`Bans`,
    roles: t`Roles`,
    edit: t`Edit`,
    invites: t`Invites`,
  };

  const setActiveTab = useCallback((tab) => {
    setArgs({
      name,
      activeTab: tab,
    });
    setTitle(`${name} - ${tabNames[tab]}`);
    setErrors([]);
    setConfirm(false);
    setSubmitting(false);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setArgs, setTitle, name]);

  useEffect(() => {
    (async () => {
      if (factionData) {
        return;
      }
      const reqFactionData = await requestFactionInfo(name);
      if (reqFactionData.errors) {
        setErrors(reqFactionData.errors);
        return;
      }
      setFactionData(reqFactionData);
    })();
  }, [factionData, name]);

  /*
   * populate powerlvls in members data
   */
  const recalculateMemberRoles = useCallback((pMembers, memberUid) => {
    if (!pMembers || !factionData) {
      return pMembers;
    }
    if (memberUid === factionData.myUid) {
      setFactionData(null);
      setBanData(null);
      setInviteData(null);
      return null;
    }
    let changed = false;
    const { roles } = factionData.faction;
    for (let i = 0; i < pMembers.length; i += 1) {
      const member = pMembers[i];
      if (!memberUid || member.uid === memberUid) {
        let memberPowerlvl = 0;
        if (member.roles?.length) {
          memberPowerlvl = Math.max(
            ...member.roles.map((frid) => roles.find(
              (fr) => fr.frid === frid,
            ).factionlvl),
          );
        }
        if (memberPowerlvl !== member.powerlvl) {
          let powerlvlName;
          if (memberPowerlvl >= 100) {
            powerlvlName = 'sovereign';
          } else if (memberPowerlvl >= 80) {
            powerlvlName = 'magistrate';
          } else if (memberPowerlvl >= 50) {
            powerlvlName = 'noble';
          } else {
            powerlvlName = 'peasant';
          }
          pMembers[i] = {
            ...member,
            powerlvl: memberPowerlvl,
            powerlvlName,
          };
          changed = true;
        }
        if (memberUid) {
          break;
        }
      }
    }
    if (changed) {
      return pMembers.sort((a, b) => b.powerlvl - a.powerlvl);
    }
    return pMembers;
  }, [factionData]);

  useEffect(() => {
    (async () => {
      if (!factionData) {
        return;
      }
      if (activeTab === 'members' && !memberData) {
        let reqMemberData = await requestFactionMembers(name);
        if (reqMemberData.errors) {
          setErrors(reqMemberData.errors);
          return;
        }
        reqMemberData = recalculateMemberRoles(reqMemberData);
        setMemberData(reqMemberData);
      } else if (activeTab === 'bans' && !banData) {
        const reqBanData = await requestFactionBans(name);
        if (reqBanData.errors) {
          setErrors(reqBanData.errors);
          return;
        }
        setBanData(reqBanData);
      } else if (activeTab === 'invites' && !inviteData) {
        const reqInviteData = await requestFactionInvites(name);
        if (reqInviteData.errors) {
          setErrors(reqInviteData.errors);
          return;
        }
        setInviteData(reqInviteData);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberData, banData, factionData, activeTab, name]);

  const submitLeaveFaction = useCallback(async (factionName) => {
    if (submittingRef.current) {
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
      setMemberData(null);
      setFactionData((pFactionData) => ({
        ...pFactionData,
        powerlvl: null,
      }));
    }
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitJoinFaction = useCallback(async (factionName) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const {
      errors: respErrors, patches,
    } = await requestJoinFaction(factionName);
    if (patches) {
      dispatch(applyPatches(patches));
    }
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setMemberData(null);
      setFactionData((pFactionData) => ({
        ...pFactionData,
        powerlvl: 0,
      }));
    }
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitDeleteFaction = useCallback(async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    const {
      errors: respErrors, patches,
    } = await requestDeleteFaction(name);
    if (patches) {
      dispatch(applyPatches(patches));
    }
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setFactionData(null);
    }
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, name]);

  const submitAddFactionRole = useCallback(async (uid, frid) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const { errors: respErrors } = await requestAddFactionRole(uid, frid);
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setMemberData((members) => {
        const memberIndex = members?.findIndex((m) => m.uid === uid);
        if (memberIndex !== -1) {
          const newMembers = [...members];
          const member = newMembers[memberIndex];
          newMembers[memberIndex] = {
            ...member,
            roles: [...member.roles, frid],
          };
          console.log('add faction role to ', newMembers, uid);
          return recalculateMemberRoles(newMembers, uid);
        }
        return members;
      });
    }
    setConfirm(false);
    setSubmitting(false);
  }, [recalculateMemberRoles]);

  const submitRemoveFactionRole = useCallback(async (uid, frid) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const { errors: respErrors } = await requestRemoveFactionRole(uid, frid);
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setMemberData((members) => {
        const memberIndex = members?.findIndex((m) => m.uid === uid);
        if (memberIndex !== -1) {
          const newMembers = [...members];
          const member = newMembers[memberIndex];
          newMembers[memberIndex] = {
            ...member,
            roles: member.roles.filter((r) => r !== frid),
          };
          return recalculateMemberRoles(newMembers, uid);
        }
        return members;
      });
    }
    setConfirm(false);
    setSubmitting(false);
  }, [recalculateMemberRoles]);

  const submitDeleteFactionRole = useCallback(async (frid) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const {
      errors: respErrors, patches,
    } = await requestFactionRoleDelete(frid);
    if (patches) {
      dispatch(applyPatches(patches));
    }
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setFactionData((pFactionData) => ({
        ...pFactionData,
        faction: {
          ...pFactionData.faction,
          roles: pFactionData.faction.roles.filter(
            (role) => role.frid !== frid,
          ),
        },
      }));
    }
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitKickBanMember = useCallback(async (uid, factionName, isBan) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const {
      errors: respErrors,
    } = await requestKickBanFactionMember(uid, factionName, isBan);
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setMemberData((members) => members.filter((m) => m.uid !== uid));
      setBanData(null);
    }
    setConfirm(false);
    setSubmitting(false);
  }, []);

  const submitLiftBan = useCallback(async (fbid, factionName) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const { errors: respErrors } = await requestLiftFactionBan(
      fbid, factionName,
    );
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setBanData((bans) => bans.filter((b) => b.fbid !== fbid));
    }
    setConfirm(false);
    setSubmitting(false);
  }, []);

  const submitCreateRole = useCallback(async (evt) => {
    evt.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const factionlvl = Number(evt.target.factionlvl.value);
    const roleName = evt.target.name.value;
    const isDefault = evt.target.isdefault.checked;
    const valErrors = [];
    const error = validateFactionName(roleName);
    if (error) valErrors.push(error);
    if ((!factionlvl && factionlvl !== 0)
      || (factionlvl > 127 || factionlvl < -128)
    ) {
      valErrors.push(t`Select a valid pwerlevel`);
    }
    if (valErrors.length) {
      setErrors(valErrors);
      return;
    }

    setSubmitting(true);
    const files = await uploadRef.current?.();
    const customFlagId = files?.[0]?.mediaId || null;
    const {
      errors: respErrors, patches, frid,
    } = await requestFactionRoleCreate(
      name, roleName, isDefault, customFlagId, factionlvl,
    );
    if (patches) {
      dispatch(applyPatches(patches));
    }
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setSelected(null);
      setErrors([]);
      setFactionData((pFactionData) => ({
        ...pFactionData,
        faction: {
          ...pFactionData.faction,
          roles: [...pFactionData.faction.roles, {
            frid,
            name: roleName,
            factionlvl,
            customFlagId,
            isProtected: false,
            isDefault,
          }],
        },
      }));
    }
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const submitCreateInvite = useCallback(async (evt) => {
    evt.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const isOneTime = evt.target.isonetime.checked;

    setSubmitting(true);
    const {
      errors: respErrors, inviteId,
    } = await requestFactionInviteCreate(name, isOneTime);
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setSelected(null);
      setErrors([]);
      setInviteData((pInviteData) => [
        ...pInviteData,
        {
          id: inviteId,
          isOneTime,
          createdAt: (new Date()).toLocaleString(),
          amountUsed: 0,
        },
      ]);
    }
    setConfirm(false);
    setSubmitting(false);
  }, [name]);

  const submitDeleteInvite = useCallback(async (inviteId) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const {
      errors: respErrors,
    } = await requestFactionInviteDelete(inviteId);
    if (respErrors) {
      setErrors(respErrors);
    } else {
      setErrors([]);
      setInviteData((pInviteData) => pInviteData.filter(
        ({ id }) => id !== inviteId,
      ));
    }
    setConfirm(false);
    setSubmitting(false);
  }, []);

  const submitEditRole = useCallback(async (evt, role) => {
    evt.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const {
      frid,
      name: prevRoleName,
      factionlvl: prevFactionlvl,
      isDefault: prevIsDefault,
    } = role;
    const factionlvl = Number(evt.target.factionlvl.value);
    const roleName = evt.target.name.value;
    const isDefault = evt.target.isdefault.checked;

    let changed = false;
    const factionRoleChanges = { frid };
    if (factionlvl !== prevFactionlvl) {
      changed = true;
      factionRoleChanges.factionlvl = factionlvl;
    }
    if (roleName !== prevRoleName) {
      changed = true;
      factionRoleChanges.name = roleName;
    }
    if (isDefault !== prevIsDefault) {
      changed = true;
      factionRoleChanges.isDefault = isDefault;
    }
    if (!changed) {
      return;
    }

    const valErrors = [];
    const error = validateFactionName(roleName);
    if (error) valErrors.push(error);
    if ((!factionlvl && factionlvl !== 0)
      || (factionlvl > 127 || factionlvl < -128)
    ) {
      valErrors.push(t`Select a valid powerlevel`);
    }
    if (valErrors.length) {
      setErrors(valErrors);
      return;
    }

    setSubmitting(true);
    const respErrors = await dispatch(
      changeFactionRole(factionRoleChanges),
    );
    if (!respErrors.length) {
      setFactionData((pFactionData) => ({
        ...pFactionData,
        faction: {
          ...pFactionData.faction,
          roles: pFactionData.faction.roles.map((pRole) => {
            if (pRole.frid !== frid) {
              return pRole;
            }
            return { ...pRole, ...factionRoleChanges };
          }),
        },
      }));
    }
    setErrors(respErrors);
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitEditRoleFlag = useCallback(async (frid, customFlagId) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const respErrors = await dispatch(
      changeFactionRole({ frid, customFlagId }),
    );
    if (!respErrors.length) {
      setFactionData((pFactionData) => ({
        ...pFactionData,
        faction: {
          ...pFactionData.faction,
          roles: pFactionData.faction.roles.map((pRole) => {
            if (pRole.frid !== frid) {
              return pRole;
            }
            return { ...pRole, customFlagId };
          }),
        },
      }));
    }
    setErrors(respErrors);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitEditFaction = useCallback(async (evt, faction) => {
    evt.preventDefault();
    if (submittingRef.current) {
      return;
    }
    const {
      name: factionName,
      title: prevTitle,
      description: prevDescription,
      isPrivate: prevIsPrivate,
      isPublic: prevIsPublic,
    } = faction;
    const factionTitle = evt.target.title.value;
    const factionDescription = evt.target.description.value;
    const isPrivate = evt.target.isprivate.checked;
    const isPublic = evt.target.ispublic.checked;

    let changed = false;
    const factionChanges = { name: factionName };
    if (factionTitle !== prevTitle) {
      changed = true;
      factionChanges.title = factionTitle;
    }
    if (factionDescription !== prevDescription) {
      changed = true;
      factionChanges.description = factionDescription;
    }
    if (isPrivate !== prevIsPrivate) {
      changed = true;
      factionChanges.isPrivate = isPrivate;
    }
    if (isPublic !== prevIsPublic) {
      changed = true;
      factionChanges.isPublic = isPublic;
    }
    if (!changed) {
      return;
    }

    const valErrors = [];
    let error = validateFactionTitle(factionTitle);
    if (error) valErrors.push(error);
    error = validateDescription(factionDescription);
    if (error) valErrors.push(error);
    if (valErrors.length) {
      setErrors(valErrors);
      return;
    }

    setSubmitting(true);
    const respErrors = await dispatch(
      changeFaction(factionChanges),
    );
    if (!respErrors.length) {
      setFactionData((pFactionData) => ({
        ...pFactionData,
        faction: {
          ...pFactionData.faction,
          ...factionChanges,
        },
      }));
    }
    setErrors(respErrors);
    setConfirm(false);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitEditFactionAvatar = useCallback(async (factionName, avatarId) => {
    if (submittingRef.current) {
      return;
    }
    setSubmitting(true);
    const respErrors = await dispatch(
      changeFaction({ name: factionName, avatarId }),
    );
    if (!respErrors.length) {
      setFactionData((pFactionData) => ({
        ...pFactionData,
        faction: {
          ...pFactionData.faction,
          avatarId,
        },
      }));
    }
    setErrors(respErrors);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!factionData) {
    return (
      <div className="content" key="loading">
        {errors.map((error) => (
          <p key={error} className="errormessage">
            <span>{t`Error`}</span>:&nbsp;{error}</p>
        ))}
        {!errors.length && (<h3>{t`Loading...`}</h3>)}
      </div>
    );
  }

  const { powerlvl, faction } = factionData;

  const availableTabs = Object.keys(tabNames).filter((p) => {
    switch (p) {
      case 'edit':
        return powerlvl >= FACTION_PERMISSIONS.EDIT_FACTION;
      case 'roles':
        return powerlvl >= FACTION_PERMISSIONS.EDIT_ROLES;
      case 'bans':
        return powerlvl >= FACTION_PERMISSIONS.UNBAN;
      case 'invites':
        return powerlvl >= FACTION_PERMISSIONS.MANAGE_INVITES;
      default:
        return true;
    }
  });

  let powerlvlName;
  if (powerlvl >= 100) {
    powerlvlName = 'sovereign';
  } else if (powerlvl >= 80) {
    powerlvlName = 'magistrate';
  } else if (powerlvl >= 50) {
    powerlvlName = 'noble';
  } else if (powerlvl >= 0 || faction.isMember) {
    powerlvlName = 'peasant';
  } else {
    powerlvlName = 'stranger';
  }

  const didPrintErrors = (
    (activeTab === 'members' && memberData?.length)
    || (activeTab === 'roles' && selected && selected !== '@create-role')
    || (activeTab === 'edit')
  );
  let content = null;
  if (!availableTabs.includes(activeTab)) {
    content = <h3 key="notallowed">{t`Not Allowed`}</h3>;
  } else if (activeTab === 'overview') {
    /* ============================== OVERVIEW =============================== */
    const [
      mediaUrl, thumbUrl,
    ] = getUrlsFromMediaIdAndName(faction.avatarId, 'avatar');
    content = (
      <div className={`factionwin-${activeTab}`} key={activeTab}>
        {(thumbUrl) && (
          <div
            className="avatar-big"
            style={{
              backgroundImage: `url(${cdn`${thumbUrl}`})`,
            }}
            onClick={(evt) => {
              evt.stopPropagation();
              link('PLAYER', {
                reuse: true,
                target: 'blank',
                args: { uri: mediaUrl },
              });
            }}
          />
        )}
        <span className="factionlist-key">{t`Description`}: </span>{faction.description}<br />
        <Stat
          text={t`Today Placed Pixels`}
          value={faction.dailyTotalPixels}
        />
        <Stat
          text={t`Daily Rank`}
          value={faction.dailyRanking}
          zero="N/A"
          rank
        />
        <Stat
          text={t`Placed Pixels`}
          value={faction.totalPixels}
        />
        <Stat
          text={t`Total Rank`}
          value={faction.ranking}
          zero="N/A"
          rank
        />
        <Stat
          text={t`Members`}
          value={faction.memberCount}
        />
        {(faction.roles.find((r) => r.customFlagId)) && (
          <Fragment key="rolelist">
            <span className="factionlist-key">{t`Role Flags`}: </span>
            {faction.roles.map(({ customFlagId, name: roleName }) => {
              const [flagUrl] = getUrlsFromMediaIdAndName(customFlagId);
              if (!flagUrl) {
                return null;
              }
              return (
                <img
                  key={customFlagId}
                  className="chatflag presentation"
                  src={cdn`${flagUrl}`}
                  title={roleName}
                  alt=""
                />
              );
            })}<br />
          </Fragment>
        )}
        <div className="form-actions">
          <ClipboardCopyField
            hideField="true"
            text={window.location.origin + buildPopUpUrl('FACTION', { name })}
          />
          <button
            type="button"
            title={t`Refresh`}
            onClick={() => {
              setFactionData(null);
              setBanData(null);
              setMemberData(null);
              setInviteData(null);
              setConfirm(null);
            }}
          ><IoIosRefresh /></button>
          {(powerlvl === null && faction.isPublic) && (
            <button
              key="joinbutton"
              type="button"
              disabled={submitting}
              title={t`Join Faction`}
              onClick={() => {
                submitJoinFaction(name);
              }}
            >
              {t`Join Faction`}
            </button>
          )}
          {(powerlvl !== null) && (
            <button
              key="leavebutton"
              type="button"
              disabled={submitting}
              className={confirm ? 'confirm' : undefined}
              title={t`Leave Faction`}
              onClick={() => {
                if (confirm !== 'leave') {
                  setConfirm('leave');
                  return;
                }
                submitLeaveFaction(name);
              }}
            >
              {/* t: button for leaving a faction, it asks for confirmation */}
              {(confirm === 'leave') ? t`Confirm Leave` : t`Leave Faction`}
            </button>
          )}
        </div>
      </div>
    );
  } else if (activeTab === 'members' && memberData) {
    /* =============================== MEMBERS =============================== */
    if (!memberData.length) {
      content = (
        <div className={`factionwin-${activeTab}`} key={activeTab}>
          <p>{t`All members of this faction are hidden`}</p>
        </div>
      );
    } else {
      const canBan = powerlvl >= FACTION_PERMISSIONS.BAN;
      const canChangeRoles = powerlvl >= FACTION_PERMISSIONS.ASSIGN_ROLES;
      content = (
        <div className={`factionwin-${activeTab}`} key={activeTab}>
          <div className="factionlist">{memberData.map((member) => {
            const {
              name: memberName, username, avatarId,
              powerlvlName: memberPowerlvlName,
              powerlvl: memberPowerlvl,
            } = member;
            const [, thumb] = getUrlsFromMediaIdAndName(avatarId, 'avatar');
            const canBanMember = canBan && powerlvl > memberPowerlvl;
            const canChangeMemberRoles = canChangeRoles && powerlvl >= memberPowerlvl;

            const item = (
              <div
                key={username}
                className="factionlist-item"
                onClick={() => {
                  if (!canBanMember && !canChangeMemberRoles) {
                    return;
                  }
                  if (username === selected) {
                    setSelected(null);
                  } else {
                    setSelected(username);
                  }
                  setErrors([]);
                  setConfirm(false);
                }}
                role="button"
                tabIndex={0}
              >
                {(thumb) && (
                  <img
                    src={cdn`${thumb}`}
                    loading="lazy"
                    className="memberlist-avatar"
                    alt=""
                  />
                )}
                <span className="memberlist-name">
                  <span
                    role="button"
                    tabIndex={-1}
                    className="modallink"
                    onClick={(evt) => {
                      evt.stopPropagation();
                      link('USER', {
                        target: 'parent',
                        args: { username },
                      });
                    }}
                  >{memberName}</span>
                </span>
                <span className="memberlist-username">[{username}]</span>
                <span className={`factionlist-square powerlvl-${memberPowerlvlName}`} />
              </div>
            );

            if (username === selected && (canBan || canChangeRoles)) {
              const { roles: memberRolesIds } = member;
              return (
                <div
                  key={`edit-${faction.name}`}
                >
                  {item}
                  <div className="factionlist-edit">
                    {errors.map((error) => (
                      <p key={error} className="errormessage">
                        <span>{t`Error`}</span>:&nbsp;{error}</p>
                    ))}
                    {(canChangeMemberRoles) && (
                      <Fragment key="changeroles">
                        <span className="factionlist-key">{t`Remove Roles`}: </span>
                        {faction.roles.filter((role) => memberRolesIds.includes(role.frid)).map((role) => {
                          const [flagUrl] = getUrlsFromMediaIdAndName(role.customFlagId);
                          let roleClassName = 'factionlist-role';
                          const { factionlvl, frid } = role;
                          const confirmString = `role-${frid}`;
                          if (factionlvl >= 100) {
                            roleClassName += ' powerlvl-sovereign';
                          } else if (factionlvl >= 80) {
                            roleClassName += ' powerlvl-magistrate';
                          } else if (factionlvl >= 50) {
                            roleClassName += ' powerlvl-noble';
                          } else {
                            roleClassName += ' powerlvl-peasant';
                          }
                          if (confirm === confirmString) {
                            roleClassName += ' confirm';
                          }
                          return (
                            <span
                              key={role.frid}
                              role="button"
                              tabIndex={-1}
                              className={roleClassName}
                              onClick={() => {
                                if (factionlvl >= 50 && confirm !== confirmString) {
                                  setConfirm(confirmString);
                                  return;
                                }
                                submitRemoveFactionRole(member.uid, role.frid);
                              }}
                            >
                              {(flagUrl) && (
                                <img
                                  className="chatflag presentation"
                                  src={cdn`${flagUrl}`}
                                  alt=""
                                />
                              )} {(confirm === confirmString && factionlvl >= 50) ? t`Confirm` : role.name}
                            </span>
                          );
                        })}<br />
                        <span className="factionlist-key">{t`Assign Roles`}: </span>
                        {faction.roles.filter((role) => !memberRolesIds.includes(role.frid)).map((role) => {
                          const [flagUrl] = getUrlsFromMediaIdAndName(role.customFlagId);
                          let roleClassName = 'factionlist-role';
                          const { factionlvl, frid } = role;
                          const confirmString = `role-${frid}`;
                          if (factionlvl >= 100) {
                            roleClassName += ' powerlvl-sovereign';
                          } else if (factionlvl >= 80) {
                            roleClassName += ' powerlvl-magistrate';
                          } else if (factionlvl >= 50) {
                            roleClassName += ' powerlvl-noble';
                          } else {
                            roleClassName += ' powerlvl-peasant';
                          }
                          if (confirm === confirmString) {
                            roleClassName += ' confirm';
                          }
                          return (
                            <span
                              key={frid}
                              role="button"
                              tabIndex={-1}
                              className={roleClassName}
                              onClick={() => {
                                if (factionlvl >= 50 && confirm !== confirmString) {
                                  setConfirm(confirmString);
                                  return;
                                }
                                submitAddFactionRole(member.uid, frid);
                              }}
                            >
                              {(flagUrl) && (
                                <img
                                  className="chatflag"
                                  src={cdn`${flagUrl}`}
                                  alt=""
                                />
                              )} {(confirm === confirmString && factionlvl >= 50) ? t`Confirm` : role.name}
                            </span>
                          );
                        })}<br />
                        <span className="factionlist-key">{t`(click a role to assign or remove it)`}</span>
                      </Fragment>
                    )}
                    <div className="form-actions">
                      {(canBanMember) && (
                        <Fragment key="kickban">
                          <button
                            type="button"
                            className={confirm === 'kick' ? 'confirm' : undefined}
                            disabled={submitting}
                            onClick={() => {
                              if (confirm !== 'kick') {
                                setConfirm('kick');
                                return;
                              }
                              submitKickBanMember(member.uid, name, false);
                            }}
                          >
                            {/* t: button for kicking a user from a faction, it asks for confirmation */}
                            {(confirm === 'kick') ? t`Confirm Kick` : t`Kick`}
                          </button>
                          <button
                            type="button"
                            className={confirm === 'ban' ? 'confirm' : undefined}
                            disabled={submitting}
                            onClick={() => {
                              if (confirm !== 'ban') {
                                setConfirm('ban');
                                return;
                              }
                              submitKickBanMember(member.uid, name, true);
                            }}
                          >
                            {/* t: button for banning a user from a faction, it asks for confirmation */}
                            {(confirm === 'ban') ? t`Confirm Ban` : t`Ban`}
                          </button>
                        </Fragment>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(null);
                          setErrors([]);
                          setConfirm(false);
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
          })}
          </div>
        </div>
      );
    }
  } else if (activeTab === 'bans' && banData) {
    /* =============================== BANS ================================= */
    if (!banData.length) {
      content = (
        <div className={`factionwin-${activeTab}`} key={activeTab}>
          <p>{t`Nobody is banned from this faction`}</p>
        </div>
      );
    } else {
      content = (
        <div className={`factionwin-${activeTab}`} key={activeTab}>
          <table className="factionbans-table">
            <thead>
              <tr>
                { /* t: who is affected by a faction ban */ }
                <th>{t`affects`}</th>
                { /* t: who created a faction ban "by: moderator" */ }
                <th>{t`by`}</th>
                { /* t: created at time when user got baned from faction */ }
                <th>{t`created at`}</th>
                { /* t: Lift faction ban */ }
                <th>{t`lift`}</th>
              </tr>
            </thead>
            <tbody>
              {banData.map(({ fbid, affects, createdBy, createdAt }) => (
                <tr key={fbid}>
                  <td>{affects}</td>
                  <td>{createdBy}</td>
                  <td>{createdAt}</td>
                  <td>
                    <button
                      type="button"
                      className={confirm === `lift-${fbid}` ? 'confirm' : undefined}
                      disabled={submitting}
                      onClick={() => {
                        if (confirm !== `lift-${fbid}`) {
                          setConfirm(`lift-${fbid}`);
                          return;
                        }
                        submitLiftBan(fbid, name);
                      }}
                    >
                      {(confirm !== `lift-${fbid}`) ? '🗑' : '‣'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  } else if (activeTab === 'roles') {
    /* =============================== Roles ================================ */
    let roleContent;
    if (selected === '@create-role') {
      roleContent = (
        <Fragment key="role-create">
          <h3>{t`Create Role`}</h3>
          <form onSubmit={submitCreateRole} className="client-form">
            <div className="form-group">
              <label>{t`Name`}:
                <input
                  type="text"
                  name="name"
                  placeholder="Name"
                  required
                /></label>
              <small>{t`Name of this role`} [a-z][A-Z][0-9].-_</small>
            </div>

            <div className="form-group form-group-avatar">
              <span>{t`Custom Flag`}:
                <FileUpload
                  acceptedTypes="image/*"
                  keepFiles
                  maxFiles={1}
                  uploadRef={uploadRef}
                  size={32}
                  preflightRoute="flagpreflight"
                  uploadRoute="flagupload"
                /></span>
              <small>{t`A flag representing the role, it should be 16x11 pixels. If left empty, users with this role selected will still show their own flags.`}</small>
            </div>

            <div className="form-group">
              <label>{t`Powerlevel`}:
                <input
                  type="number"
                  name="factionlvl"
                  defaultValue={0}
                  min="-100"
                  max="100"
                  step="1"
                  required
                /></label>
              <small>{t`Powerlevel of this role. See table below for an explanation.`}</small>
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isdefault"
                  defaultChecked={false}
                />
                <span className="checkmark" />
                {t`Assign role per default to new members`}
              </label>
              <small>{t`Assign this role to every new member automatically on join.`}</small>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                disabled={submitting}
              >
                {t`Submit`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setErrors([]);
                  setConfirm(false);
                }}
              >
                {t`Cancel`}
              </button>
            </div>
          </form>
        </Fragment>
      );
    } else {
      const { roles } = faction;
      roleContent = (
        <Fragment key="role-edit">
          <div className="factionlist">{roles.map((role) => {
            const { frid, customFlagId, factionlvl, isProtected } = role;
            const [flagUrl] = getUrlsFromMediaIdAndName(customFlagId);
            let nameClass = 'rolelist-name';
            if (isProtected) {
              nameClass += ' protected';
            }
            let rolePowerlvlName = 'peasant';
            if (factionlvl >= 100) {
              rolePowerlvlName = 'sovereign';
            } else if (factionlvl >= 80) {
              rolePowerlvlName = 'magistrate';
            } else if (factionlvl >= 50) {
              rolePowerlvlName = 'noble';
            }

            const item = (
              <div
                key={frid}
                className="factionlist-item"
                onClick={() => {
                  if (frid === selected) {
                    setSelected(null);
                  } else {
                    setSelected(frid);
                  }
                  setErrors([]);
                  setConfirm(false);
                }}
                role="button"
                tabIndex={0}
              >
                {(flagUrl) && (
                  <img
                    src={cdn`${flagUrl}`}
                    loading="lazy"
                    className="chatflag"
                    alt=""
                  />
                )}
                <span className={nameClass}>{role.name}</span>
                <span className={`factionlist-square powerlvl-${rolePowerlvlName}`} />
              </div>
            );

            if (frid === selected) {
              return (
                <div
                  key={`edit-${frid}`}
                >
                  {item}
                  <div className="factionlist-edit role">
                    {errors.map((error) => (
                      <p key={error} className="errormessage">
                        <span>{t`Error`}</span>:&nbsp;{error}</p>
                    ))}
                    <div className="little-fileupload-container">
                      <span className="factionlist-key">{t`Change Flag`}:&nbsp;</span>
                      <FileUpload
                        acceptedTypes="image/*"
                        maxFiles={1}
                        uploadRef={uploadRef}
                        preflightRoute="flagpreflight"
                        uploadRoute="flagupload"
                      />
                      <button
                        type="button"
                        onClick={() => submitEditRoleFlag(frid, null)}
                        title={t`Clear`}
                        disabled={submitting || customFlagId === null}
                      >
                        <IoTrashOutline />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const files = await uploadRef.current?.();
                          if (files.length) {
                            submitEditRoleFlag(frid, files[0].mediaId);
                          }
                        }}
                        title={t`Save`}
                        disabled={submitting}
                      >
                        <RiSave3Line />
                      </button>
                    </div>

                    <form
                      onSubmit={(evt) => submitEditRole(evt, role)}
                      className="client-form"
                    >
                      <span className="factionlist-key">{t`Name`}:&nbsp;</span>
                      <input
                        type="text"
                        name="name"
                        placeholder="Name"
                        defaultValue={role.name}
                        required
                      /><br />

                      <span className="factionlist-key">{t`Powerlevel`}:&nbsp;</span>
                      <input
                        type="number"
                        name="factionlvl"
                        defaultValue={role.factionlvl}
                        min="-100"
                        max="100"
                        step="1"
                        required
                      /><br />

                      <input
                        type="checkbox"
                        name="isdefault"
                        defaultChecked={role.isDefault}
                      /> {t`Assigned role per default`}

                      <div className="form-actions">
                        <button
                          type="submit"
                          disabled={submitting}
                        >
                          {t`Save`}
                        </button>
                        {(!role.isProtected && powerlvl >= FACTION_PERMISSIONS.CREATE_ROLES) && (
                          <button
                            type="button"
                            key="delete-role"
                            className={(confirm === 'delete') ? 'confirm' : undefined}
                            onClick={() => {
                              if (confirm !== 'delete') {
                                setConfirm('delete');
                                return;
                              }
                              submitDeleteFactionRole(frid);
                            }}
                          >
                            {/* t: button for deleting a faction role, it asks for confirmation */}
                            {(confirm === 'delete') ? t`Confirm Delete` : t`Delete`}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(null);
                            setErrors([]);
                            setConfirm(false);
                          }}
                        >
                          {t`Cancel`}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              );
            }
            return item;
          })}
          </div>

          {(powerlvl >= FACTION_PERMISSIONS.CREATE_ROLES) && (
            <div className="form-actions" key="create-roles">
              <button
                type="button"
                onClick={() => {
                  setSelected('@create-role');
                  setErrors([]);
                  setConfirm(false);
                }}
              >
                {t`Create New Role`}
              </button>
            </div>
          )}
        </Fragment>
      );
    }

    content = (
      <div className={`factionwin-${activeTab}`} key={activeTab}>
        {roleContent}
        <h3>{t`Permissions of Powerlevels`}</h3>
        <p>{t`A role has all the permissions of all levels below and equal to it. In example: Every role with a power level of >=50 can manage invites (50).`}</p>
        <table>
          <thead>
            <tr>
              <th>{t`Permission`}</th>
              { /* t: Powerlevel of faction role, don't translate if in doubt */ }
              <th>{t`Level`}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{t`Manage invites`}</th>
              <th>{FACTION_PERMISSIONS.MANAGE_INVITES}</th>
            </tr>
            <tr>
              <th>{t`Kick members`}</th>
              <th>{FACTION_PERMISSIONS.KICK}</th>
            </tr>
            <tr>
              <th>{t`See hidden users in member list`}</th>
              <th>{FACTION_PERMISSIONS.SEE_HIDDEN_USERS}</th>
            </tr>
            <tr>
              <th>{t`Assign roles below their own`}</th>
              <th>{FACTION_PERMISSIONS.ASSIGN_ROLES}</th>
            </tr>
            <tr>
              <th>{t`Ban members`}</th>
              <th>{FACTION_PERMISSIONS.BAN}</th>
            </tr>
            <tr>
              <th>{t`Unban members`}</th>
              <th>{FACTION_PERMISSIONS.UNBAN}</th>
            </tr>
            <tr>
              <th>{t`Edit roles below their own`}</th>
              <th>{FACTION_PERMISSIONS.EDIT_ROLES}</th>
            </tr>
            <tr>
              <th>{t`Create roles`}</th>
              <th>{FACTION_PERMISSIONS.CREATE_ROLES}</th>
            </tr>
            <tr>
              <th>{t`Edit faction`}</th>
              <th>{FACTION_PERMISSIONS.EDIT_FACTION}</th>
            </tr>
            <tr>
              <th>{t`Edit their own role and elevate users to their own level`}</th>
              <th>{FACTION_PERMISSIONS.MANAGE_YOURSELF}</th>
            </tr>
            <tr>
              <th>{t`Delete the faction`}</th>
              <th>{FACTION_PERMISSIONS.DELETE_FACTION}</th>
            </tr>
          </tbody>
        </table>
      </div>
    );
  } else if (activeTab === 'edit') {
    /* ================================ EDIT ================================ */
    const { avatarId } = faction;
    const [thumbUrl] = getUrlsFromMediaIdAndName(avatarId, 'avatar');

    content = (
      <div className={`factionwin-${activeTab}`} key={activeTab}>

        <div className="setitem">
          <div className="setrow">
            <h3 className="settitle">{t`Avatar`}</h3>
            <div className="little-fileupload-container">
              {(thumbUrl) && (
                <div
                  className="avatar"
                  style={{
                    backgroundImage: `url(${cdn`${thumbUrl}`})`,
                  }}
                  title={avatarId}
                />
              )}
              <FileUpload
                acceptedTypes="image/*"
                maxFiles={1}
                uploadRef={uploadRef}
              />
              <button
                type="button"
                onClick={() => submitEditFactionAvatar(name, null)}
                title={t`Clear`}
                disabled={submitting || avatarId === null}
              >
                <IoTrashOutline />
              </button>
              <button
                type="button"
                onClick={async () => {
                  const files = await uploadRef.current?.();
                  if (files.length) {
                    submitEditFactionAvatar(name, files[0].mediaId);
                  }
                }}
                title={t`Save`}
                disabled={submitting}
              >
                <RiSave3Line />
              </button>
            </div>
          </div>
          <div className="modaldesc">{
            t`Select Avatar of this Faction. Supported Formats: jpg, gif, png, webp`
          }</div>
          <div className="modaldivider" />
        </div>

        <form
          onSubmit={(evt) => submitEditFaction(evt, faction)}
          className="client-form"
        >
          <div className="form-group">
            <label htmlFor="title">{t`Title`}:
              <input
                type="text"
                name="title"
                defaultValue={faction.title}
                required
              /></label>
            <small>{t`Title of your faction`}</small>
          </div>

          <div className="form-group">
            <label>{t`Description`}:
              <textarea
                name="description"
                defaultValue={faction.description}
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
                defaultChecked={faction.isPrivate}
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
                defaultChecked={faction.isPublic}
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
              {t`Save`}
            </button>
            {(powerlvl >= FACTION_PERMISSIONS.DELETE_FACTION) && (
              <button
                key="delete"
                type="button"
                className={confirm === 'delete-faction' ? 'confirm' : undefined}
                onClick={() => {
                  if (confirm !== 'delete-faction') {
                    setConfirm('delete-faction');
                    return;
                  }
                  submitDeleteFaction();
                }}
                disabled={submitting}
              >
                {/* t: button for deleting a faction, it asks for confirmation */}
                {(confirm === 'delete-faction') ? t`Confirm Delete` : t`Delete Faction`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
            >
              {t`Cancel`}
            </button>
          </div>
        </form>
      </div>
    );
  } else if (activeTab === 'invites' && inviteData) {
    /* ============================== Invites =============================== */
    if (selected === '@create-invite') {
      content = (
        <div className={`factionwin-${activeTab}`} key={activeTab}>
          <h3>{t`Create Invite`}</h3>
          <form onSubmit={submitCreateInvite} className="client-form">
            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isonetime"
                  defaultChecked={false}
                />
                <span className="checkmark" />
                {t`Is One-Time-Invite`}
              </label>
              <small>{t`Whether or not this invite can only be used once.`}</small>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                disabled={submitting}
              >
                {t`Submit`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setErrors([]);
                  setConfirm(false);
                }}
              >
                {t`Cancel`}
              </button>
            </div>
          </form>
        </div>
      );
    } else {
      content = (
        <div className={`factionwin-${activeTab}`} key={activeTab}>
          {(inviteData.length > 0) ? (
            <table className="factionbans-table">
              <thead>
                <tr>
                  { /* t: faction invite id, no need to translate */ }
                  <th>{t`ID`}</th>
                  { /* t: for faction invites, if it can only be used once */ }
                  <th>{t`One-Time`}</th>
                  <th>{t`created at`}</th>
                  { /* t: column name of how many times an invite got used */ }
                  <th>{t`times used`}</th>
                  <th>{t`Delete`}</th>
                  <th>{t`Copy`}</th>
                </tr>
              </thead>
              <tbody>
                {inviteData.map(({ id, isOneTime, createdAt, amountUsed }) => (
                  <tr key={id}>
                    <td>{id}</td>
                    <td>{isOneTime ? 'X' : ''}</td>
                    <td>{createdAt}</td>
                    <td>{amountUsed}</td>
                    <td>
                      <button
                        type="button"
                        className={confirm === `delete-inv-${id}` ? 'confirm' : undefined}
                        disabled={submitting}
                        onClick={() => {
                          if (confirm !== `delete-inv-${id}`) {
                            setConfirm(`delete-inv-${id}`);
                            return;
                          }
                          submitDeleteInvite(id);
                        }}
                      >
                        {(confirm !== `delete-inv-${id}`) ? '🗑' : '‣'}
                      </button>
                    </td>
                    <td>
                      <ClipboardCopyField
                        hideField="true"
                        text={window.location.origin + buildPopUpUrl('I', { inviteId: id })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>{t`This faction has no invites`}</p>
          )}
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                setSelected('@create-invite');
                setErrors([]);
                setConfirm(false);
              }}
            >
              {t`Create New Invite`}
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="content" key="factionpage">
      <h2>{faction.title}</h2>
      <h3><span className={`factionlist-square powerlvl-${powerlvlName}`} /> [{faction.name}]</h3>
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
        {!didPrintErrors && errors.map((error) => (
          <p key={error} className="errormessage">
            <span>{t`Error`}</span>:&nbsp;{error}</p>
        ))}
      </div>
      {content}
    </div>
  );
};

export default Faction;
