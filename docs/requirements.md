# Gym Management Web Application — Project Requirements

## 1. Project Overview

Build a complete, modern, secure, and responsive Gym Management Web Application inspired by professional gym management platforms such as Glofox.

The application must help gym owners and staff manage members, memberships, payments, attendance, biometric check-ins, trainers, workout plans, class bookings, equipment, and reports from one centralized system.

This must be a functional full-stack web application, not just a static UI or frontend prototype.

### Main User Roles
- Admin
- Gym Manager
- Receptionist
- Trainer
- Gym Member

Each role must have appropriate permissions and access to the relevant features.

## 2. Admin Dashboard

Create a professional dashboard displaying real data from the database.

Include:
- Total members
- Active members
- Expired memberships
- Cancelled memberships
- Suspended memberships
- Memberships expiring soon
- Today's check-ins
- Today's registrations
- Monthly revenue
- Pending and overdue payments
- Recent member activity
- Recent check-in activity
- Revenue and attendance charts
- Quick actions for adding members, creating memberships, and recording payments

Include date filters, loading states, empty states, and error handling.

## 3. Member Management

Allow authorized staff to:
- Add, edit, view, search, and manage members
- Generate a unique member ID
- Store name, profile photo, phone, email, emergency contact, registration date, and notes
- Assign a membership plan
- View membership start and expiry dates
- View membership and payment status
- View attendance and payment history
- View membership renewal and cancellation history
- Search, sort, filter, and paginate member records

Prevent duplicate member records where appropriate.

## 4. Membership Management

Allow administrators to create and manage:
- Monthly memberships
- Quarterly memberships
- Six-month memberships
- Annual memberships
- Custom-duration memberships

Each membership plan should have a name, duration, price, benefits, and description.

Support:
- Membership activation
- Renewal
- Expiration
- Cancellation
- Suspension and reactivation
- Membership extensions
- Membership history
- Upcoming expiry reminders
- Membership status reports

Use the following statuses:
- Active
- Expired
- Cancelled
- Suspended

Membership validity must be calculated and checked on the backend. A cancelled, expired, or suspended membership must not be considered eligible for entry.

## 5. Biometric Fingerprint / Thumb Check-In — Critical Requirement

Implement a biometric access-control module that allows gym members to check in using a compatible fingerprint scanner.

### Required Workflow

1. A member places their thumb on the connected fingerprint scanner.
2. The system identifies and verifies the member.
3. The backend retrieves the member's current membership information.
4. The backend checks membership status, start date, expiry date, and access restrictions.
5. If the member is eligible for entry, record the check-in and display **Access Granted**.
6. If the member's membership is cancelled, expired, or suspended, display **Access Denied** with the relevant reason.
7. If the fingerprint is unknown, deny entry.
8. If the scanner, network, or authorization service is unavailable, do not automatically grant access.
9. Record denied attempts and their reasons for authorized staff to review.

### Mandatory Cancellation Rule

When an administrator cancels a membership, that member must immediately lose eligibility for future check-ins.

Example:

- A member has an active membership and can enter the gym.
- The administrator cancels the membership.
- The member scans the same thumb at the entrance.
- The system recognizes the member but denies entry because the membership has been cancelled.

**Fingerprint recognition alone must never grant access.** Every check-in must be authorized by the backend using current membership data.

Do not trust membership status stored only in the frontend, browser, or a cached scanner record.

Prevent duplicate check-in records caused by repeated scanner events.

### Hardware Integration

Before implementing real biometric functionality:
- Identify compatible fingerprint scanners.
- Check the manufacturer's SDK, drivers, APIs, and integration requirements.
- Determine whether a local service, vendor SDK, or other supported integration is necessary.
- Keep hardware integration modular so a compatible device can be connected later.

If no physical scanner is available, implement a clearly labelled simulated scanner for development and testing.

The simulation must support:
- Active member
- Expired member
- Cancelled member
- Suspended member
- Unknown fingerprint
- Scanner unavailable
- Backend authorization unavailable

Never claim simulated fingerprint verification is real biometric authentication.

### Biometric Privacy

- Avoid storing raw fingerprint images.
- Prefer secure device-side biometric matching when supported.
- Store only the minimum necessary identification references.
- Protect sensitive data and credentials.
- Include appropriate consent, retention, and deletion procedures.
- Restrict biometric administration to authorized personnel.

## 6. Attendance Management

Include:
- Daily attendance
- Member check-in timestamps
- Check-out timestamps, where supported
- Attendance history
- Daily, weekly, and monthly reports
- Search by member and date
- Successful and denied access logs
- Manual attendance corrections for authorized staff
- An audit trail for corrections

Check-out functionality should not be treated as proof that a member is eligible for a new entry.

## 7. Payments and Billing

Implement a payment management module supporting:
- Membership payment recording
- Full and partial payments, where allowed
- Cash, bank transfer, card, and other configured payment methods
- Payment references and receipts
- Paid, pending, partially paid, overdue, and refunded statuses
- Outstanding balance calculations
- Member payment history
- Refund records
- Daily, monthly, and yearly financial reports
- Search and date filters

Payment amounts and balances must be calculated and validated on the backend.

Do not mark online payments as successful without confirmation from a properly integrated payment provider.

## 8. Staff and Trainer Management

Allow authorized administrators to:
- Create and update staff accounts
- Assign roles and permissions
- Manage trainer profiles
- Record trainer specializations
- Assign members to trainers
- Manage staff and trainer schedules
- Activate or deactivate staff accounts

Use role-based permissions:

- Admin: Full system administration.
- Manager: Membership, attendance, staff operations, and authorized reports.
- Receptionist: Member registration, check-in, and permitted payment operations.
- Trainer: Assigned members, workout plans, schedules, and progress.
- Member: Own profile, membership, payments, attendance, workouts, and bookings.

Prevent unauthorized users from accessing restricted data or actions.

## 9. Workout and Exercise Management

Include:
- Exercise library
- Exercise name and description
- Muscle group and difficulty level
- Exercise instructions and optional images
- Workout plan creation
- Sets, repetitions, duration, and rest intervals
- Assigning workout plans to members
- Trainer notes
- Workout completion records
- Member progress history

## 10. Classes and Appointment Booking

Support:
- Group fitness classes
- Class name and description
- Assigned trainer
- Date, time, and duration
- Maximum class capacity
- Member reservations
- Booking cancellation
- Waitlists, where appropriate
- Personal training appointments
- Trainer availability
- Attendance for scheduled classes

Prevent duplicate bookings and conflicting appointments.

## 11. Equipment and Inventory

Include:
- Equipment name and category
- Equipment identification number
- Purchase date and cost
- Current condition
- Maintenance records
- Next maintenance date
- Repair notes
- Out-of-service status
- Maintenance reminders

## 12. Notifications and Reminders

Create in-app notifications for:
- Memberships expiring soon
- Membership expiration
- Membership cancellation or suspension
- Upcoming payments
- Successful renewals
- Upcoming classes and appointments
- Equipment maintenance

Email, SMS, and WhatsApp notifications may be integrated through suitable providers.

Clearly document which notification methods are functional and which require external credentials.

## 13. Reports and Analytics

Provide reports for:
- Member registrations
- Active, expired, cancelled, and suspended memberships
- Membership renewals
- Attendance
- Denied entry attempts
- Payments and outstanding balances
- Revenue trends
- Trainer performance and class attendance
- Equipment maintenance

Include date filters, charts, summary cards, and CSV export.

Restrict financial and sensitive reports to authorized roles.

## 14. Gym Member Portal

Provide a separate member-facing dashboard where members can:
- View their profile
- View their current membership status
- Check membership start and expiry dates
- View renewal information
- View payment history and receipts
- View attendance history
- View assigned workout plans
- Track workout progress
- View trainers and schedules
- Book or cancel eligible classes
- Receive notifications

Members must not be able to modify their own membership status, payment records, or access permissions.

## 15. Authentication and Application Security

Implement:
- Secure login and logout
- Secure password hashing
- Appropriate session or token management
- Role-based authorization
- Protected frontend routes and backend endpoints
- Server-side validation
- Rate limiting
- Protection against common web vulnerabilities
- Secure handling of environment variables
- Audit logs for sensitive actions
- Appropriate error handling
- Access restrictions between member accounts

Frontend restrictions alone are insufficient. All sensitive operations must be validated by the backend.

## 16. Recommended Technology Stack

Evaluate and use the following stack unless there is a strong technical reason to recommend an alternative:

- Frontend: React.js
- Styling: CSS or Tailwind CSS
- Backend: Node.js and Express.js
- Database: MongoDB
- API: REST API
- Charts: A suitable React chart library
- Authentication: Secure sessions or an appropriately implemented token-based system

Use reusable components, a clear folder structure, maintainable code, and consistent naming conventions.

## 17. Database Design

Create suitable database models and relationships for:
- Users and roles
- Members
- Membership plans
- Membership records and status history
- Payments and refunds
- Attendance records
- Access attempts
- Trainers and staff
- Exercises and workout plans
- Classes and bookings
- Equipment and maintenance
- Notifications
- Audit logs

Add appropriate validation, unique identifiers, and indexes.

Preserve payment and attendance history when memberships are cancelled or renewed.

## 18. User Interface and Experience

Build a polished, professional, modern interface inspired by premium gym management dashboards.

Design requirements:
- Responsive sidebar navigation
- Professional dashboard cards
- Clean tables and forms
- Search and filter controls
- Charts and reports
- Confirmation dialogs for sensitive actions
- Toast notifications for success and errors
- Consistent typography, spacing, and icons
- Responsive desktop, tablet, and mobile layouts
- Accessible labels and keyboard navigation
- Clear access-granted and access-denied screens

Use fictional sample data for development and clearly distinguish demo data from production data.

Every visible button, link, form, search, filter, and action must have meaningful functionality.

## 19. Testing and Acceptance Criteria

Test the following scenarios:

1. Register a new member.
2. Create and assign a membership.
3. Activate and renew a membership.
4. Allow check-in for an eligible member.
5. Cancel a membership and immediately deny the next check-in.
6. Deny entry for an expired membership.
7. Deny entry for a suspended membership.
8. Deny entry for an unknown fingerprint.
9. Deny access when membership authorization cannot be verified.
10. Record a payment and verify the member's updated payment history.
11. Prevent unauthorized staff from changing membership status.
12. Prevent members from accessing other members' private records.
13. Verify role permissions.
14. Test responsive layouts.
15. Verify simulated and real biometric integrations are clearly distinguished.
16. Verify reports against the actual database records.

Create automated tests for critical backend membership authorization and access-control rules wherever practical.

## 20. Development Plan and Deliverables

Develop the application in manageable phases.

### Phase 1: Foundation
- Project structure
- Database configuration
- Authentication
- Role-based access
- Dashboard layout

### Phase 2: Core Gym Management
- Member management
- Membership plans
- Membership status and history
- Payments and billing

### Phase 3: Attendance and Access Control
- Attendance records
- Simulated fingerprint check-in
- Backend membership authorization
- Access-denied logging
- Real scanner integration preparation

### Phase 4: Additional Modules
- Trainers and staff
- Workout management
- Classes and appointments
- Equipment management
- Notifications

### Phase 5: Reporting and Quality Assurance
- Analytics
- CSV export
- Security testing
- Responsive testing
- Error handling
- Documentation

Deliver:
- Complete source code
- Organized frontend and backend
- Database models
- Environment variable example file
- Setup and installation instructions
- README documentation
- Automated tests for critical features
- Biometric hardware integration documentation

### Final Instructions

Before making major implementation decisions, explain the architecture and any required external dependencies.

Build a functional MVP first, then implement additional modules incrementally. Do not generate a single oversized file containing the entire application.

Do not claim that a feature is complete until it has been implemented and tested.

Keep the biometric membership authorization rule as a top priority: a cancelled, expired, or suspended membership must never receive entry authorization.

Start by reviewing these requirements, identifying dependencies and risks, and proposing a clear implementation plan. Then proceed step by step within the selected development environment.