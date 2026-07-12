# User Administration

## Overview
Mike provides admin-only user management through the Settings > User Administration interface. Only users with the `admin` role can access this page.

## Roles
- **admin**: Can manage users, change roles, disable/enable, reset passwords, revoke sessions
- **member**: Can use Mike and manage their own profile only

## Public Signup
Public signup is **disabled**. Users can only be created by an admin through the User Administration interface.

## Admin Actions
- **List users**: View all users with email, role, status, created date, last login
- **Create user**: Creates a new user with a temporary password (shown once)
- **Change role**: Promote/demote between admin and member
- **Disable user**: Blocks login, revokes sessions, preserves data
- **Enable user**: Reactivates a disabled user
- **Reset password**: Generates a new temporary password (shown once)
- **Revoke sessions**: Forces user to log in again

## Protections
- Admin cannot disable their own account (409 CANNOT_DISABLE_SELF)
- Cannot demote or disable the last active admin (409 LAST_ADMIN_REQUIRED)
- Disabled users receive 403 USER_DISABLED on any API call
- Temporary passwords are shown only once in the response

## Audit
All admin actions are logged in `admin_audit_log` with:
- Actor (who performed the action)
- Target (who was affected)
- Action type
- Previous and new values
- Timestamp
