import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import organizationsRouter from "./organizations.js";
import invitationsRouter from "./invitations.js";
import appsRouter from "./apps.js";
import subscriptionsRouter from "./subscriptions.js";
import billingRouter from "./billing.js";
import auditRouter from "./audit.js";
import adminRouter from "./admin.js";
import shipiboRouter from "./shipibo.js";
import ayniRouter from "./ayni.js";
import transactionalEmailRouter from "./transactional-email.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/organizations", organizationsRouter);
router.use("/", invitationsRouter); // /organizations/:id/invitations AND /invitations/:token
router.use("/apps", appsRouter);
router.use("/", subscriptionsRouter); // /organizations/:orgId/subscriptions
router.use("/billing", billingRouter);
router.use("/", auditRouter); // /organizations/:orgId/audit-logs
router.use("/admin", adminRouter);
router.use("/shipibo", shipiboRouter);
router.use("/ayni", ayniRouter);
router.use("/", transactionalEmailRouter);

export default router;
