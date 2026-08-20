import { Routes, Route } from "react-router-dom";
import Dashboard from "./routes/Dashboard";
import VehicleDetail from "./routes/VehicleDetail";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/vehicles/:id" element={<VehicleDetail />} />
    </Routes>
  );
}
