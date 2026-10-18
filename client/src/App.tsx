import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { IncomingCallModal } from "./components/IncomingCallModal";
import { OutgoingCallModal } from "./components/OutgoingCallModal";
import { Bench } from "./pages/Bench";
import { Home } from "./pages/Home";
import { Room } from "./pages/Room";
import { useFaceTimeStore } from "./state/facetime";

export default function App() {
  const navigate = useNavigate();
  const initAuth = useFaceTimeStore((s) => s.initAuth);
  const navigationTarget = useFaceTimeStore((s) => s.navigationTarget);
  const clearNavigationTarget = useFaceTimeStore((s) => s.clearNavigationTarget);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (navigationTarget) {
      const target = navigationTarget;
      clearNavigationTarget();
      navigate(target);
    }
  }, [navigationTarget, clearNavigationTarget, navigate]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:code" element={<Room />} />
        <Route path="/bench" element={<Bench />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global FaceTime Call Overlays */}
      <IncomingCallModal />
      <OutgoingCallModal />
    </>
  );
}
