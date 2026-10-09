
import { Router } from "express";
import { getOpenAIProductFeed } from "../controllers/openai-feed.controller";

const router = Router();

router.get("/", getOpenAIProductFeed);

export default router;