@id("viewer")
permit (
  principal in Role::"viewer",
  action in [Action::"org:read", Action::"playbook:read"],
  resource
);

@id("editor")
permit (
  principal in Role::"editor",
  action in [Action::"org:read", Action::"org:write", Action::"playbook:read", Action::"playbook:write"],
  resource
);

@id("admin")
permit (
  principal in Role::"admin",
  action in [Action::"org:read", Action::"org:write", Action::"playbook:read", Action::"playbook:write"],
  resource
);

@id("key")
permit (principal is Key, action, resource);

@id("local-developer")
permit (principal is LocalDeveloper, action, resource);

@id("playbook-itself")
permit (principal is Playbook, action, resource);

@id("run-as-started")
permit (principal is Person, action, resource)
when { context.via == "run" };

@id("own-org")
forbid (principal, action, resource)
unless { resource in context.granted.org };

@id("within-granted-permissions")
forbid (principal, action, resource)
unless { action in context.granted.permissions };

@id("within-granted-playbooks")
forbid (principal, action, resource)
unless {
  context.granted.all_playbooks ||
  resource in context.granted.playbooks ||
  (resource is Org && !context.operation.targets_playbook)
};
