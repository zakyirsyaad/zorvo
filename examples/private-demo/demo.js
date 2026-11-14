// Runs the fictional payment module once: one charge and one refund.
// `node demo.js` prints the leaked test card number and the unchecked refund amount.

import { cardOnFile, charge, refund } from "./payment.js";

const card = cardOnFile();
charge(card, 4900, "ord_demo_1001");
refund("ord_demo_1002", 999999);