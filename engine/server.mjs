import express from "express"
import cors from "cors"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { env } from "../config/env.mjs"
import { logger } from "../core/logger.mjs"
import { engineRouter, ENGINE_PUBLIC_DIR } from "../web/routes/engine.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = env.CSI_PORT

logger.warn("DEPRECATED — engine/server.mjs is a compatibility shim. Use web/server.mjs (port 3000): routes now live in web/routes/engine.mjs and are mounted at /api on the web server.", { port: PORT })

const app = express()
app.use(cors())
app.use(express.json({ limit: "10mb" }))

app.use("/api", engineRouter)
app.use("/", express.static(ENGINE_PUBLIC_DIR))
if (!fs.existsSync(path.join(ENGINE_PUBLIC_DIR, "index.html"))) {
  app.use((_req, res) => { res.status(404).json({ error: "Not found" }) })
}

app.listen(PORT, () => {
  logger.warn(`CSI Engine compatibility shim running on port ${PORT} (deprecated, use web/server.mjs)`)
})