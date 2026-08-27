import { Routes, Route } from "react-router-dom";
import Dashboard from "./routes/Dashboard";
import VehicleDetail from "./routes/VehicleDetail";
import Settings from "./routes/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/vehicles/:id" element={<VehicleDetail />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}
