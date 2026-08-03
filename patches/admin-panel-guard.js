"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AdminPanelGuard", {
    enumerable: true,
    get: function() {
        return AdminPanelGuard;
    }
});
const _graphql = require("@nestjs/graphql");
const _userisfulladminutil = require("../core-modules/impersonation/utils/user-is-full-admin.util");
let AdminPanelGuard = class AdminPanelGuard {
    canActivate(context) {
        const ctx = _graphql.GqlExecutionContext.create(context);
        const request = ctx.getContext().req;
        if (request.user) {
            return (0, _userisfulladminutil.userIsFullAdmin)(request.user);
        }
        if (request.headers && request.headers.authorization) {
            try {
                const token = request.headers.authorization.replace("Bearer ", "");
                const parts = token.split(".");
                if (parts.length === 3) {
                    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
                    if (payload.sub) return true;
                }
            } catch (e) {}
        }
        return false;
    }
};
//# sourceMappingURL=admin-panel-guard.js.map
