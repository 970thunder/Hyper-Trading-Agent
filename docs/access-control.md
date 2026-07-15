# Access Control Model

Hyper Trading Agent separates organization administration from platform operations. A signed-in user always acts within one active organization; platform administrators are an explicitly granted, cross-organization role.

## Role Matrix

| Capability | Viewer | Member | Admin | Owner | Platform administrator |
| --- | --- | --- | --- | --- | --- |
| View organization sessions, reports, knowledge and completed runs | Yes | Yes | Yes | Yes | Yes |
| Start chats, research, correlation analysis, backtests and swarm runs | No | Yes | Yes | Yes | Yes |
| Upload approved files to an existing knowledge base | No | Yes | Yes | Yes | Yes |
| Manage knowledge-base configuration and delete shared sources | No | No | Yes | Yes | Yes |
| Manage models, tools, agents, audit and organization usage views | No | No | Yes | Yes | Yes |
| Create, change or remove organization members | No | No | No | Yes | Yes |
| Change the organization usage policy | No | No | No | Yes | Yes |
| View or operate another organization | No | No | No | No | Yes |
| Manage service-wide users, organizations, knowledge, jobs, audit and storage | No | No | No | No | Yes |
| Operate process-wide channels, schedules, live connectors, metrics or shutdown controls | No | No | No | No | Yes |

## Enforcement Rules

- Browser sessions are httpOnly cookies. In commercial mode every business API requires an authenticated organization session; an operator API key never grants an organization role.
- Organization-owned resources are resolved through their owner tables before reads or writes. A foreign identifier returns `404` where revealing its existence would be unsafe.
- Viewer is a read-only role. Workload-bearing calls, including correlation analysis, reject Viewer requests at the API boundary.
- Process-wide controls use the platform-administrator guard. Organization Owner and Admin are intentionally insufficient because those resources are shared by every tenant.
- Suspending a user or organization revokes its active browser sessions. Removing a membership also revokes that organization session.

## Platform Administrator Bootstrap

Set `HYPER_TRADING_PLATFORM_ADMIN_EMAILS` in the production environment before bootstrapping the first Owner. The bootstrap identity is granted platform access on login. Platform access can subsequently be granted or revoked from `/platform`, while the configured bootstrap administrator and the final remaining platform administrator cannot be removed.
