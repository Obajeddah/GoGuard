# GatePass roadmap

## Current updates

- [x] Audit unfinished app flows and security checks; email setup will be handled by the user.
- [ ] Prepare clean source ZIP only after user reviews the diagnosis and confirms.

## Audit findings to address before launch

- [ ] Signup: pass the issued signup ticket to account creation; wire plan choice and Turnstile into the form; fail closed when captcha is not configured.
- [ ] Payments: settle payment and entitlement atomically; currently payment can be marked successful before the school's entitlement update succeeds.
- [ ] Integrate branch management, branch administrator/guard invites and four-digit edit-code controls into the admin screens.
- [ ] Apply the selected branch to dashboard, directory, attendance and reports queries; add explicit class filters and complete export pagination (reports currently cap at 1,000).
- [ ] Verify signup, two-step sign-in, role/branch isolation and bus login/location/emergency end to end using authorized test accounts.
- [ ] Verify live Paystack webhook configuration and successful payment readback without charging an unapproved test payment.
- [ ] Update self-hosting configuration instructions, captcha variables and deployment target; rehearse clean migration and private photo storage setup.
- [x] Team opens its own staff page instead of redirecting to Settings (signed-in browser check unavailable: requester has no matching account).
- [x] Rename the app GoGuard and replace campus wording with school wording.
- [x] Homepage Bimbo review and confirmed school/student/release figures.
- [ ] Additional testimonials — waiting for genuine approved customer quotes.
- [x] Homepage FAQ and full plan comparison on Pricing.

- [x] Fix compilation errors from the branch, bus-login and pricing updates.

- [x] Org signup with verified email (schools: own domain only)
- [x] One parent registration link per org (up to 4 guardians: name, relationship, email, picture, general-notification toggle)
- [x] Guardian QR passes + public pass page
- [x] Guard scanner with check-in / check-out, audio + animation
- [x] Live dashboard, members (manual + CSV), reports with CSV export, gate staff
- [ ] Email notifications on scan (parent = all, scanned guardian = own, opted-in guardians = all), with "Not expecting this? Call the school" emergency button — blocked: needs an email sender domain
- [ ] Email each guardian their pass link after registration — blocked: same

## From second brief (GatePass overview)

- [x] ~~Landing: pricing tiers Starter ₦7,500/mo, Pro ₦15,000/mo~~ replaced by ₦3,800/mo or ₦38,000/yr
- [x] Signup as multi-step onboarding
- [x] Reports: quick Today / This month presets; export opens in Excel
- [x] Scanner: offline state handling
- [x] Palette leans slate / emerald green

## Third brief (school-first polish)

- [x] Remove decorative badge/pill tags; professional copy pass across the app
- [x] Landing: school-first, mentions estate + industry tools; header shows only Register / Sign in
- [x] ~~Register and Sign in pages with School / Industry / Estate tabs~~ replaced: schools only for now
- [x] Schools set an emergency line (at signup + Settings); shown to parents/guardians
- [x] Gate staff see Live, Students, Scanner, Reports read-only; no admin actions (Settings, link, edits, export)
- [x] Parents never sign in — link-only registration
- [x] School-only focus: remove industry/estate sign-up tabs and landing section (estate/industry kept internally for later)

## Fourth brief (subscription)

- [x] Pricing: ₦3,800/month or ₦38,000/year (one-time); replace Starter/Pro on home page
- [x] 14-day free trial from sign-up; show days left to admins
- [x] After trial unpaid: block spreadsheet export and halt all gate emails (export done; emails will check this rule once sending is built)
- [x] Checkout for monthly + yearly via Paystack (card, transfer, USSD), webhook + return page
- [x] Paystack secret key saved; checkout opens Paystack (verified)
- [x] Live Paystack key saved; live checkout opens (verified)
- [ ] Set live webhook URL in Paystack — blocked: app must be published first

## Fifth brief (lean site)

- [x] Home page: short, to the point — what it does, Register, Check our pricing (no prices, no how-to)
- [x] Separate Pricing page; every plan shows the 14-day free trial
- [x] Keep database portable (PostgreSQL) for future self-hosting

## Sixth brief (classes + duplicates)

- [x] School ticks the classes it offers (Settings); preset Nigerian classes + custom
- [x] Parent registration form: class is a required choice from the school's classes
- [x] Students page: group/filter by class; show students with no class
- [x] "Possible duplicate" flag when the same child name appears more than once, so the school can cross-check before deleting

## Seventh brief (2027 home page, strict passes, school bus)

- [x] Home page: modern glassmorphic design, same short copy
- [x] Every QR pass works only for its own guardian, child and school; changing the guardian's name, photo or child issues a new pass
- [x] Transport package toggle in Settings unlocks a Fleet tab
- [x] Fleet admin: buses (number, plate, route), driver/attendant accounts, assign crew, assign riders
- [x] Crew change creates a parent notice for that bus
- [ ] Email bus notices to parents — blocked: needs an email sender domain
- [x] Drivers/attendants sign in straight to the bus app
- [x] Bus app: Start/End ride, Waiting / Onboard tabs, one-tap board/drop, guardian photo + pass check for afternoon drop-off
- [x] GPS location while a ride is on; offline queue that syncs when back online
- [x] Live fleet map with speed, progress and onboard counts

## Eighth brief (bus pupils)

- [x] Parent form: "My child takes the school bus" tick (only when the school has transport)
- [x] Fleet → Bus pupils: ticked pupils wait in "Needs a bus" until the school puts them on a bus with its crew
- [x] Ride update notice per pupil boarded / dropped off (none on Start ride)
- [ ] Email ride updates to bus parents — blocked: needs an email sender domain
- [x] Private bus link for bus parents: child's status, bus, crew, last location (hidden once child is dropped)
- [x] Bus app: Start ride only starts the ride; a separate Onboard pupils button opens the list

## Ninth brief (bus parents by email)

- [x] Bus app: "Drop all at school" for morning pick-up rides before noon only; afternoon drop-offs stay one by one
- [x] Start / End ride only switch the bus location on and off; no notices, no explanation text
- [x] Every ride email carries two support links: "Not expecting this?" (school emergency line) and "Where is my child?"
- [x] "Where is my child?" page: "Last seen at <area> · N minutes ago" only while the child is on board; no map
- [x] Parents no longer get a link to save on the registration page; Fleet keeps full live tracking for the school
- [ ] Send the ride emails — blocked: needs an email sender domain

## Tenth brief (attendance, plans, Fleet access)

- [x] Automatic attendance for every class from gate scans and bus rides; admin downloads all classes to one Excel file
- [x] Home page: three tick cards again (Verified guardians. / QR gate passes. / Instant parent alerts.)
- [x] Clear one-line descriptions for Gate passes, School bus, Classes, Reports
- [x] Remove the Parent notices tab from Fleet
- [x] Plans: Gate ₦7,500/mo (was ₦12,000), Gate + Transport ₦15,000/mo (was ₦21,000), Full session ₦90,000 (was ₦120,000); 14-day trial
- [x] Fleet and bus app only with transport ticked + trial or a transport plan
- [x] Self-hosting notes and settings template for GitHub
- [ ] Push to GitHub — waiting on the user to create and connect their GitHub account

## Eleventh brief (polish)

- [x] Home page: smaller, sleeker tick cards
- [x] Browser tab icon uses the GatePass logo

## Eleventh brief (bus login, branches, security)

- [ ] Fleet map: "Open in Google Maps" — admin's location to the bus's live location
- [ ] One login per bus (replaces personal driver/attendant logins); set when adding a bus; admin can change password or deactivate
- [ ] Only the bus login's device sends location; admin opening the bus app never shares location
- [ ] Driver can pause location; admin or parent "Where is my child?" asks the bus device for one fresh location, then it pauses again
- [ ] Bus app emergency button (hold 1 second): alerts the school (dashboard + emergency email), nothing to parents
- [ ] Editing a child's details needs a 4-digit code, changeable in Settings
- [ ] Two-step sign-in (2FA) settings
- [ ] Captcha on school sign-up
- [ ] Branches: HQ admin sees all, branch staff locked to their branch; branch switcher; branch isolation in data
- [ ] Reports: filter by date range, branch, class; download CSV of the filtered rows
- [ ] Alerts tied to the child's branch; parent with children in several branches can switch child on the parent page
