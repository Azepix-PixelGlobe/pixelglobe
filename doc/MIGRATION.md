# Pixelplanet 4.0

With this release, we drop support for MySQL and only support MariaDB now.
MariaDB supports backups created by mysqldump, so if you are on mysql and want
to migrate, you may do:
`backup -> remove mysql and install mariadb -> restore`
No more details about this process are mentioned here. But remember that that
the 3.1.0 release is very stable, so no need to rush.

Users are not allowed to choose usernames that do not start with [a-z][A-Z]
anymore, if you want to reset old users, that don't do that, run the following
sql query:

```
UPDATE Users SET username = CONCAT('pp_', id) WHERE username NOT REGEXP '^[A-Za-z]';
```

The following redis keys aren't used anymore because captchas and js challenges
got moved into sql: `trus:*`, `chal:*`, `chip:*`, `capt:*`, `human:*`.
Commands to remove them:

```bash
redis-cli KEYS "trus:*" | xargs redis-cli DEL
redis-cli KEYS "chal:*" | xargs redis-cli DEL
redis-cli KEYS "chip:*" | xargs redis-cli DEL
redis-cli KEYS "capt:*" | xargs redis-cli DEL
redis-cli KEYS "human:*" | xargs redis-cli DEL
```

# Pixelplanet <2.0 to 2.0

The 2.0 release comes with a total revamp of the account system, proxy detection
and more. Its database layout is not compatible with previous versions.

The configuration moved to the file `config.ini`, which you have to edit and copy
all the configs, that you previously had in `ecosystem.yml`, to.

We can not offer automatic migration of the SQL database.
However, a migration script got shipped with this version. Make sure to BACK UP
your SQL database before running it.

Migration script (uses the sql database configured in config.ini):

```bash
node scripts/migrate2.js
```

The following redis keys aren't used anymore and
can be deleted: `isal:*`, `chip`, `sess:*`.
Which can be done with those commands:

```bash
redis-cli KEYS "isal:*" | xargs redis-cli DEL
redis-cli KEYS "sess:*" | xargs redis-cli DEL
redis-cli DEL chip
```
