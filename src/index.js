import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // ካለህ (ካልሌለህ ችግር የለውም)
import App from './App';
import 'bootstrap/dist/css/bootstrap.min.css'; // Bootstrap ስታይል እንዲሰራ

// React 18 አጠቃቀም
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    {/* ጠቃሚ ማሳሰቢያ፦ እዚህ ጋር <BrowserRouter> በፍጹም አትጨምር። 
      ራውተሩን በ App.js ውስጥ ስላስገባነው፣ እዚህ ጋር ደግመህ ካስገባኸው 
      "Uncaught Error: You cannot render a <Router> inside another <Router>" 
      የሚል ስህተት ያመጣብሃል።
    */}
    <App />
  </React.StrictMode>
);