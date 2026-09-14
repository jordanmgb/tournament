import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBLsVdGLiXn0L558jn8_RGHcDlAijIlSGE",
  authDomain: "mgb-tournaments.firebaseapp.com",
  projectId: "mgb-tournaments",
  storageBucket: "mgb-tournaments.firebasestorage.app",
  messagingSenderId: "526973440948",
  appId: "1:526973440948:web:12acc0956a563e956d58e1",
  measurementId: "G-QP7MFNX8DK",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
