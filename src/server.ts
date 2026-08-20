import "dotenv/config";
import app from "./app";

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {
  //console.log(`Sure-Buy API running on http://localhost:${PORT}`);
    console.log(`Sure-Buy API running on port ${PORT}`);
});