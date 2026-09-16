# Architecture

Outline is composed of a backend and frontend codebase in this monorepo. As both are written in TypeScript, they share some code where possible. We utilize the latest ES6 language features, including `async`/`await`, and types. oxfmt formatting and Oxlint are enforced by CI.

## Frontend

Outline's frontend is a React application compiled with [Vite](https://vitejs.dev/). It uses [MobX](https://mobx.js.org/) for state management and [Styled Components](https://www.styled-components.com/) for component styles. Unless global, state logic and styles are always co-located with React components together with their subcomponents to make the component tree easier to manage.

```
app
├── actions     - Reusable actions such as navigating, opening, creating entities
├── components  - React components reusable across scenes
├── editor      - React components specific to the editor
├── hooks       - Reusable React hooks
├── menus       - Context menus, often appear in multiple places in the UI
├── models      - State models using MobX observables
├── routes      - Route definitions, note that chunks are async loaded with suspense
├── scenes      - A scene represents a full-page view that contains several components
├── stores      - Collections of models and associated fetch logic
├── types       - TypeScript types
└── utils       - Utility methods specific to the frontend
```

## Backend

The API server is driven by [Koa](http://koajs.com/), it uses [Sequelize](http://docs.sequelizejs.com/) as the ORM and Redis with [Bull](https://github.com/OptimalBits/bull) for queues and async event management. Authorization logic
is contained in [cancan](https://www.npmjs.com/package/cancan) policies under the "policies" directory.

Interested in more documentation on the API routes? Check out the [API documentation](https://getoutline.com/developers).

```
server
├── routes            - All API routes are contained within here
│   ├── api           - API routes
│   └── auth          - Authentication routes
├── commands          - Complex commands that perform actions across multiple models
├── config            - Database configuration
├── emails            - Transactional email templates
│   └── templates     - Classes that define each possible email template
├── middlewares       - Shared Koa middlewares
├── migrations        - Database migrations
├── models            - Sequelize models
├── onboarding        - Markdown templates for onboarding documents
├── policies          - Authorization logic based on cancan
├── presenters        - JSON presenters for database models, the interface between backend -> frontend
├── queues            - Async queue definitions
│   └── processors    - Processors perform jobs on events from the event bus
│   └── tasks         - Tasks are arbitrary async jobs not from the event bus
├── services          - Services start distinct portions of the application eg api, worker
├── static            - Static assets
├── test              - Test helpers and fixtures, tests themselves are colocated
└── utils             - Utility methods specific to the backend
```

## Shared

Where logic is shared between the client and server it is placed in this directory. This is generally
small utilities.

```
shared
├── components        - Shared React components that are used in both the frontend and backend
├── editor            - The text editor, based on Prosemirror
├── i18n              - Internationalization configuration
│   └── locales       - Language specific translation files
├── styles            - Styles, colors and other global aesthetics
└── utils             - Shared utility methods
```

## Workspace passwords

The `passwords` plugin adds `/passwords` and a Password sidebar item. Members can manage workspace credentials; viewers can read them; guests have no access. All queries are restricted to the authenticated workspace. This is a shared workspace vault, without per-entry permissions or a separate master password.

`PasswordService` implements the operations shared by the authenticated API and MCP tools:

| API endpoint (POST) | MCP tool | Input |
| --- | --- | --- |
| `/api/passwords.list` | `list_passwords` | `offset`, `limit` (maximum 100), optional `category`; returns metadata, filtered total and write permission, without secrets |
| `/api/passwords.info` | `get_password` | `id`; explicitly returns the secret |
| `/api/passwords.create` | `create_password` | `site` (HTTP/S URL), `username`, `password`, optional `name` (display name, up to 200 characters), `category` and `notes` |
| `/api/passwords.update` | `update_password` | `id`, current `version`, and only the fields to change |
| `/api/passwords.delete` | `delete_password` | `id`, current `version`; permanent deletion |

API responses use Outline's `{ data: ... }` envelope. List returns `{ entries, total, canWrite }`. Create, list and update never return the password. Update and delete lock the row and reject stale versions with HTTP 409. In the UI, leaving the password input blank during editing preserves the existing password; an empty password sent directly to the API is rejected.

The table keeps every credential on one line. Site names link to the saved URL, with a hostname fallback for unnamed entries. Notes open in a separate dialog on request and remain available to agents through the API. The optional name is stored inside the encrypted payload; older entries require no migration, and partial updates preserve an existing name.

Categories are `password` (default), `key`, `environment`, and `file`. The UI shows a separate section for each; API and MCP clients can omit the filter to list all categories. Migration `20260916174801-add-password-category` adds an indexed, non-secret category column so filtering and pagination run in the database without decrypting unrelated entries. Existing records default to `password`; recategorizing an entry preserves its secret. File entries hold a secret and a link to the original file, not uploaded binary data.

Existing Outline API-key and OAuth scopes apply. `passwords:read` allows listing and reading secrets; `passwords:write` allows all password operations. Exact route scopes can restrict access further, such as `/api/passwords.list` for metadata only. Document-only tokens cannot use the password tools. Reconnect or refresh the MCP tool inventory after deployment to discover the five new tools. Agents should fetch an individual secret only when required by the user's task and never copy it into document content or logs.

Migration `20260916164029-create-passwords` creates a dedicated `passwords` table. Site, username, password and notes are stored together as AES-256-GCM ciphertext. A per-workspace key is derived from `SECRET_KEY` with HKDF-SHA256 and a feature-specific context. Authenticated additional data binds ciphertext to its workspace and record ID. There are no plaintext credential columns, document revisions, search entries, or Markdown exports. Back up the database and preserve `SECRET_KEY` separately; losing that key makes the vault unreadable. Server administrators with both the database and key can decrypt it.

API responses have `Cache-Control: no-store`. The UI fetches secrets on demand, keeps them out of persistent stores, and hides disclosed values after 30 seconds, window blur, or a visibility change. Copied values remain in the operating system clipboard. Deletion removes the live database row; existing database backups retain their previous copies.

Before release, back up the database and run migrations with `yarn db:migrate`. Returning to the previous application image leaves the new table intact. Do not undo this migration on a populated vault: its down migration drops the table. Tests cover API and MCP CRUD, scopes, workspace isolation, guest/viewer restrictions, ciphertext authentication, invalid input and conflicting edits.
