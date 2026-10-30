import { Router, type IRouter } from "express";
import flashcardsRouter from "./flashcards";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(flashcardsRouter);

export default router;
