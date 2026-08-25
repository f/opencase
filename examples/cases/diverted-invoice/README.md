# The Diverted Invoice

This package is a wholly fictional composite. All people, companies, domains,
accounts, transfers, and events are invented. Reserved `.example` domains are
used for playable values.

The mechanics are inspired by the FBI's public guidance about business email
compromise (BEC): criminals can impersonate trusted business correspondents,
request changed payment instructions, and divert legitimate transfers. The
FBI also emphasizes acting quickly and contacting financial institutions when
fraud is discovered. This case simplifies recovery into a deterministic
eight-minute game clock; it is not operational banking or legal guidance.

Sources:

- [FBI — Business Email Compromise](https://www.fbi.gov/how-we-can-help-you/scams-and-safety/common-frauds-and-scams/business-email-compromise)
- [FBI Denver — Business E-mail Compromise Fraud Alert](https://www.fbi.gov/contact-us/field-offices/denver/news/press-releases/business-e-mail-compromise-fraud-alert)

Adapted mechanics:

- compare a sender domain with a trusted supplier record;
- verify an unexpected beneficiary change through independent data;
- escalate a confirmed diversion before a time-sensitive recall window closes.

The PNG evidence photographs were generated with ImageGen for this fictional
training package. Exact playable values live in `evidence.*.reports`, not in
image pixels.
