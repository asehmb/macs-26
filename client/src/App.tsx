import { Navigate, Route, Routes } from "react-router-dom";
import { Bench } from "./pages/Bench";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";
import { WorldSpike } from "./world/WorldSpike";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:code" element={<Room />} />
      <Route path="/bench" element={<Bench />} />
      <Route path="/world-spike" element={<WorldSpike />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
