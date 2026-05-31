import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import platformsRouter from "./platforms";
import campaignsRouter from "./campaigns";
import transactionsRouter from "./transactions";
import analyticsRouter from "./analytics";
import uploadRouter from "./upload";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(platformsRouter);
router.use(campaignsRouter);
router.use(transactionsRouter);
router.use(analyticsRouter);
router.use(uploadRouter);

export default router;
