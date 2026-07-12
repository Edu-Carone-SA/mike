# User Roles Security Model

## Role Definitions

### admin
- Full access to User Administration
- Can create, disable, enable users
- Can change roles
- Can reset passwords
- Can revoke sessions
- Can view audit logs
- Cannot disable own account
- Cannot demote/disable last active admin

### member
- Can use Mike normally
- Can manage own profile (display name, organisation, model preferences)
- Can manage own API keys (when not managed by server)
- Cannot access User Administration
- Cannot view other users
- Cannot change roles

## Access Control Architecture

### Backend
1. `requireAuth` middleware validates JWT and loads user profile
2. `requireAuth` checks `user_profiles.status` — disabled users get 403
3. `requireAdmin` middleware checks `user_profiles.role === 'admin'`
4. Admin routes under `/admin/*` require both middlewares

### Frontend
1. Settings tab "User Administration" only renders for `role === 'admin'`
2. Direct URL access to `/account/user-administration` shows "Admin access required"
3. Backend also enforces — frontend hiding is defense-in-depth, not primary control

### Database
- `user_profiles.role`: CHECK constraint (`admin`, `member`)
- `user_profiles.status`: CHECK constraint (`active`, `disabled`)
- `admin_audit_log`: RLS enabled, only service_role can access

## GoTrue Integration
- GoTrue is the source of truth for identity (email, password hash)
- `user_profiles` is the source of truth for application roles
- Disabled users are banned in GoTrue (`ban_duration: "87600h"`)
- Session revocation via `admin.signOut(userId)`
- JWTs may remain valid until expiry — backend checks `status` on every request
