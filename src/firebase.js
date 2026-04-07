import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const auth = firebase.auth();
export const firestore = firebase.firestore();

// Lazy RTDB accessor for legacy modules. This avoids initialization warnings
// when Realtime Database is not provisioned for this project.
let _databaseInstance = null;
export const database = {
  ref: (...args) => {
    if (!_databaseInstance) {
      // Import side-effect intentionally deferred until first use.
      // eslint-disable-next-line global-require
      require("firebase/compat/database");
      _databaseInstance = firebase.database();
    }
    return _databaseInstance.ref(...args);
  },
};

export default firebase;
