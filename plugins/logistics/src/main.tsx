import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LogisticsAdminPage } from "./pages/LogisticsAdminPage";
import { ProductLogisticsTab } from "./pages/ProductLogisticsTab";
import { ProductLogisticsBadge } from "./pages/ProductLogisticsBadge";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LogisticsAdminPage />} />
        <Route path="/product-tab" element={<ProductLogisticsTab />} />
        <Route path="/product-info" element={<ProductLogisticsBadge />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
