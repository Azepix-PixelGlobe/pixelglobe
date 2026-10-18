import { patchState } from '../src/store/index.js';
/*

const state = {
  channels: {
    1: [[1, 2, 3, 4]],
  },
  haha: 'lol',
}
*/

const state = {"fishes":[],"badges":[],"factions":[{"userFactionFlags":0,"avatarId":"cfegeo:jpg","memberCount":2,"description":"Talk about KPOP","title":"Babymonster","name":"kpop","fid":"fd216450-2649-42a9-b457-de3b949d280e","roles":[{"frid":"058e6f7a-55d8-407c-9d6f-386390cf17ab","customFlagId":null,"isMember":1,"name":"Peasant","factionlvl":0,"isProtected":true,"isDefault":true},{"frid":"10238515-5ac3-4c76-b75a-d730958d4ef1","customFlagId":null,"isMember":1,"name":"Sovereign","factionlvl":100,"isProtected":true,"isDefault":false}],"isPrivate":false,"isPublic":true,"isHidden":false},{"userFactionFlags":0,"avatarId":"ddtfyk:jpg","memberCount":1,"description":"x","title":"xx","name":"xx","fid":"816da735-499f-400d-83ed-f1acfb085c4f","roles":[{"frid":"3bb698c2-a3cc-42a6-80d4-5b0c7fad0c28","customFlagId":null,"isMember":1,"name":"Peasant","factionlvl":0,"isProtected":true,"isDefault":true},{"frid":"13d7645d-489b-4093-a150-799ebc0c4313","customFlagId":null,"isMember":1,"name":"Sovereign","factionlvl":100,"isProtected":true,"isDefault":false}],"isPrivate":false,"isPublic":false,"isHidden":false}],"activeFactionRole":"13d7645d-489b-4093-a150-799ebc0c4313","customFlag":"ck","avatarId":null,"fetched":true};
/*
const patch = {
  op: 'addnx',
  path: 'channels.3[0:1]',
  value: [5, 6, 7, 8],
}
*/
const patch = {"op":"del","path":"factions[fid:fd216450-2649-42a9-b457-de3b949d280e]","value":{"avatarId":"cfegeo:jpg","channelId":74,"memberCount":2,"description":"Talk about KPOP","title":"Babymonster","name":"kpop","fid":"fd216450-2649-42a9-b457-de3b949d280e","sqlFid":21,"roles":[{"frid":"058e6f7a-55d8-407c-9d6f-386390cf17ab","customFlagId":null,"name":"Peasant","factionlvl":0,"isProtected":true,"isDefault":true},{"frid":"10238515-5ac3-4c76-b75a-d730958d4ef1","customFlagId":null,"name":"Sovereign","factionlvl":100,"isProtected":true,"isDefault":false}],"isPrivate":false,"isPublic":true}};

console.log(JSON.stringify(state), '\n', patch, '\n', JSON.stringify(patchState(state, patch)));
