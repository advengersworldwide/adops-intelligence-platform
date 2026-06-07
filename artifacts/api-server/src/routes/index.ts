import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import platformsRouter from "./platforms";
import platformCostModelsRouter from "./platform-cost-models";
import billingRecordsRouter from "./billing-records";
import billingRouter from "./billing";
import buyingHousesRouter from "./buying-houses";
import transactionsRouter from "./transactions";
import analyticsRouter from "./analytics";
import uploadRouter from "./upload";
import fileUploadRouter from "./file-upload";
import rolesRouter from "./roles";
import usersRouter from "./users";
import aiRouter from "./ai";
import billsRouter from "./bills";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(platformsRouter);
router.use(platformCostModelsRouter);
router.use(billingRecordsRouter);
router.use(billingRouter);
router.use(buyingHousesRouter);
router.use(transactionsRouter);
router.use(analyticsRouter);
router.use(uploadRouter);
router.use(fileUploadRouter);
router.use(rolesRouter);
router.use(usersRouter);
router.use(aiRouter);
router.use(billsRouter);

export default router;
