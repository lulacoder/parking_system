import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/database";

const firebaseConfig = {
  apiKey: "AIzaSyABQTi4Sl21Cf_i5yIt5v8l_h2vCDocTFQ",
  authDomain: "digital-parking-f9d2c.firebaseapp.com",
  databaseURL: "https://digital-parking-f9d2c-default-rtdb.firebaseio.com",
  projectId: "digital-parking-f9d2c",
  storageBucket: "digital-parking-f9d2c.firebasestorage.app",
  messagingSenderId: "189959832842",
  appId: "1:189959832842:web:8c4b38090b8b2a61b466f3"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// እነዚህን Export ማድረግህን እንዳትረሳ
export const auth = firebase.auth();
export const database = firebase.database();
export default firebase;