# SQL Layout

Tables are created by the `.sql` files in `./scheme`.
Functions in `./functions` and procedures in `./procedures`.

The current version of the database layout is defined in `./scheme/version.txt`.
To add a tabe, add its definition in the `scheme` folder, increment the
`version.txt` and add a migration file
`./migrations/[oldversion]-[newversion].sql` that also creates the table, which
will run on update.
If you create a new `.sql` file under `./scheme/`, you have to add it to
`order.txt`. Since tables depend on each other, the order of execution is
important.

Same with changes of columns, change them in both `scheme`, add a `migration`
and increment the `versions.txt`.

To add a procedure, add it into the `./procedures/*.sql`, add a DROP statement
to `./procedures/drop.sql` and increment the `./procedures/version.txt`.
On version mismatch, the `drop.sql` will be executed and then all other `*.sql`
files inside the folder.
Functions are handled just like procedures, but in the `functions` folder.

## clean-up files

`.sql` files in he `./cleanup` folder will get executed every hour, they are
meant to do clean-up operations.
If they are prepended by `[number]-name.sql`, the number is the chance in
percent to be executed every single hour.
