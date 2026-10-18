# API Websocket

This websocket provides unlimited access to many functions of the site, it is used for Chat Bridges and similar stuff.

Websocket url:
`https://[dev.]pixelplanet.fun/mcws`

Connection just possible with header:

```
Authorization: "Bearer APISOCKETKEY"
```

All requests are made as JSON encoded array.

### Subscribe to chat messages

send

```["sub", "chat"]```

you get a reply with the list of public channels followed by a list of staff

```["chans", [[id1, name1], [id2, name2], ...], [[ id, username, isAdmin], ...]]```

All chat messages, except the once you send with `mchat` will be sent to you in the form:

```["msg", name, uid, message, country, channelId]```
channelId is an integer. id is the user id
country is the [two-letter country code](https://www.nationsonline.org/oneworld/country_code_list.htm) in lowercase

Mass deletion of user messages in public channels will be announced to you in the form:

```["dpum", username, uid]```

### Subscribe to online user counter

send

```["sub", "online"]```

Online counter will be sent to you all 10s as typical binary package (see `src/socket/packets/OnlineCounter.js`)

### Subscribe to pixel packages

send

```["sub", "pxl"]```

All pixels (including your own) will be sent to you as typical binary packages

### Subscribe to User reload notifications

send

```["sub", "reloadUser"]```

Whenever a user should be reloaded, because something about his account changed, you get a message

```["reloadUser", userId]```

### Set Pixel

```[ "setpxl", minecraftid, ip, x, y, clr ]```

(x, y, clr are integers, rest strings)

Sets a pixel with the according cooldown to minecraftid, ip. Minecraftid is optional, but ip is required if it is given. If both minecraftid and ip are null/None, the pixel will get set without cooldown check. No race condition checks are performed.

You will get a reply with:

```["retpxl", id, error, success, waitSeconds, coolDownSeconds]```

(id and error as strings, success as boolean, waitSeconds and coolDownSeconds as float)

ID is minecraftid, if given, else ip. 
error is a message on error, else null.
success... self explanatory 
waitSeconds is the current cooldown. 
coolDownSeconds is the added cooldown (negative if pixel couldn't be set because max cooldown got reached)

### Send Chat Message

```["mchat", username, message, channelId]```

channelId is an integer
username is the username of the user or a matrix ID in @name:homeserver.com format.
If it is a matrix ID, it will be sent with the apisockets own user.

You will get a return to tell you if it was successful, uid will be 0 if user doesn't exist:

```["chatret", username, uid, accepted (boolean)]```
