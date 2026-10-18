/*
 *
 */
import { getBanInfos } from '../../data/sql/Ban.js';

async function baninfo(req, res) {
  req.tickRateLimiter(3000);

  const { ttag: { t }, user, ip: { ipString } } = req;

  const bans = await getBanInfos(ipString, user?.id, null, null);

  if (!bans.length) {
    throw new Error(t`You are not banned`);
  }

  const infos = bans.map((ban) => ({
    uuid: ban.buuid,
    reason: ban.reason,
    /* null if permanent */
    sleft: ban.expires
      && Math.ceil((ban.expires.getTime() - Date.now()) / 1000),
    mod: ban.muid && `${ban.mname} (${ban.muid})`,
  }));

  res.status(200).json(infos);
}

export default baninfo;
