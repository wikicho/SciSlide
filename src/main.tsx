import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import App from "./App";
import { AudienceApp } from "./components/AudienceApp";
import { PresenterApp } from "./components/PresenterApp";
import { audienceToken, presenterToken } from "./lib/presenter";
import "./styles.css";
const token = presenterToken(window.location.hash);
const audience = audienceToken(window.location.hash);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {audience ? (
      <AudienceApp token={audience} />
    ) : token ? (
      <PresenterApp token={token} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
