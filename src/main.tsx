import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import App from "./App";
import { PresenterApp } from "./components/PresenterApp";
import { presenterToken } from "./lib/presenter";
import "./styles.css";
const token = presenterToken(window.location.hash);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {token ? <PresenterApp token={token} /> : <App />}
  </React.StrictMode>,
);
