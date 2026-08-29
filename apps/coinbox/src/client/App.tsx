import { Routes, Route } from "react-router-dom";
import Home from "./routes/Home";
import Ledger from "./routes/Ledger";
import Recurring from "./routes/Recurring";

/**
 * Three top-level sections. Deep links work on a hard refresh because
 * wrangler.jsonc sets `not_found_handling: "single-page-application"`.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/ledger" element={<Ledger />} />
      <Route path="/recurring" element={<Recurring />} />
    </Routes>
  );
}
