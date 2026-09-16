import { Password, Team, User } from "@server/models";
import { allow } from "./cancan";
import { and, isTeamModel, isTeamMutable } from "./utils";

allow(User, "listPasswords", Team, (actor, team) =>
  and(isTeamModel(actor, team), !actor.isGuest, !actor.isSuspended)
);
allow(User, "createPassword", Team, (actor, team) =>
  and(
    isTeamModel(actor, team),
    isTeamMutable(actor),
    !actor.isGuest,
    !actor.isViewer,
    !actor.isSuspended
  )
);
allow(User, "read", Password, (actor, password) =>
  and(isTeamModel(actor, password), !actor.isGuest, !actor.isSuspended)
);
allow(User, ["update", "delete"], Password, (actor, password) =>
  and(
    isTeamModel(actor, password),
    isTeamMutable(actor),
    !actor.isGuest,
    !actor.isViewer,
    !actor.isSuspended
  )
);
