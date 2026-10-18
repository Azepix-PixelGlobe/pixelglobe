# Privacy and data retention policies

This document exists not only to inform users, but also to keep track for
developers, to prevent accidental privacy violations.

## Data stored for every user

| Value                             | Duration    | Where   | Reason                                |
|-----------------------------------|-------------|:--------|--------------------------------------:|
| anonymized IP and Request Details | 2 Weeks     | Storage | ordinary server logs                  |
| IP and Request Details            | 2 Weeks     | Storage | server logs when request causes error |
| IP placing a pixel (conditional)  | 2 Weeks     | Storage | logs for game administration          |

Request details are only logged for selected requests, like REST api usage. Not
for every single request.

Full IPs are never accessible to game moderators, but only to server admins,
which are kept to a minimum amunt of people with server access (currently ~2).
Game moderators only get access to subnets a user is in, in cases relevant to
them.

## Additional data stored for logged in users

| Value                              | Duration          | Where    | Reason                     |
|------------------------------------|-------------------|:---------|---------------------------:|
| IP of User and connection date     | 2 Weeks           | Database | account integrity checking |
| Email if provided                  | Account existence | Database | login                      |
| Third party id if provided         | Account existence | Database | login                      |
| User placing a pixel (conditional) | 2 Weeks           | Storage  | logs for game moderation   |

Checking account integrity is neccessary to determine when an account got shared
or stolen.

IPs, emails and third party ids are never accessible to game moderators, but
only to server admins.

## In case of a ban

To prevent ban evasion, some data has to be kept even after account deletion,
but only for the duration of a ban, this includes the login method (email and
third party ids) and ip.

## In case of abuse

In case of IP abuse, like DDoS attacks and proxy usage for malicious behaviour,
we may share the IP and type of abuse to third parties to get them flagged,
which might impact their ability to use other platforms as well.

## Resolved IP information

For the basic functionality of the game (people without account being able to
place), we resolve informations concerning an IP, this currently consists of:

### Whois Data from Internet Addresses Registries

- Country
- Internet Provider
- Oranisation (same as Internet Provider usually)
- ASN

### Proxy checks

- type of connection (mobile, residental, business, vpn, proxy,...)
- whether or not the IP is a proxy or VPN
- provider of the proxy if applicable
- region or city of the IP if applicable
- amount of devices seen using an IP and subnet

This is public data, not data captured by us. It is stored for ten days up to
two weeks in a database. It is currently being fetched for each visiting IP.
