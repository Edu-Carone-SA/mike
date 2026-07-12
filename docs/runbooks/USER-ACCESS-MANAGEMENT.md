# Runbook: User Access Management

## Create a User
1. Login as admin at https://mike.agov.app
2. Go to Settings > User Administration
3. Click "Add User"
4. Enter email and select role (member/admin)
5. Click "Create"
6. **Copy the temporary password** — it will not be shown again
7. Share credentials with the user securely

## Disable a User
1. Find user in the User Administration table
2. Click the ban icon (⊘)
3. Confirm the action
4. User is immediately blocked:
   - GoTrue session revoked
   - User banned in GoTrue
   - `user_profiles.status` set to `disabled`
   - Any future API calls return 403

## Enable a User
1. Find the disabled user in the table
2. Click the check icon (✓)
3. User can now log in again

## Reset Password
1. Find user in the table
2. Click the key icon (🔑)
3. Confirm the action
4. **Copy the new temporary password** — it will not be shown again
5. Old password stops working immediately
6. User sessions are revoked

## Revoke Sessions
1. Find user in the table
2. Click the logout icon (⏻)
3. User's refresh tokens are revoked
4. User must log in again

## Change Role
1. Find user in the table
2. Use the role dropdown to select member/admin
3. Change takes effect immediately

## Recover Last Admin
If the last admin is accidentally disabled:
1. Connect to the RDS database via ECS one-off task
2. Run: `UPDATE user_profiles SET role='admin', status='active', disabled_at=NULL WHERE email='<admin-email>';`
3. Run: Unban the user in GoTrue via admin API

## Query Audit Log
```sql
SELECT action, actor_email, target_email, previous_value, new_value, created_at
FROM admin_audit_log
ORDER BY created_at DESC
LIMIT 50;
```
