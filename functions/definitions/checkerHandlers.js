const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { sendTextMessage, sendImageMessage } = require("./common/sendMessage")
const { sendWhatsappTextMessage, markWhatsappMessageAsRead } = require("./common/sendWhatsappMessage");
const { getReponsesObj } = require("./common/utils");
const { sendScamAssessmentMessage } = require("./common/sendFactCheckerMessages")
const { getSignedUrl } = require("./common/mediaUtils")

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.checkerHandlerWhatsapp = async function (message) {
  const from = message.from; // extract the phone number from the webhook payload
  const type = message.type;
  const db = admin.firestore();
  let responses

  switch (type) {
    case "button":
      const button = message.button;
      switch (button.text) {
        case "Yes!":
          await onFactCheckerYes(button.payload, from, "whatsapp")
          break;
        case "No":
          responses = await getReponsesObj("factCheckers");
          sendWhatsappTextMessage("factChecker", from, responses.VOTE_NO, message.id);
          break;
      }
      break;
    case "interactive":
      // handle voting here
      const interactive = message.interactive;
      switch (interactive.type) {
        case "list_reply":
          await onVoteReceipt(db, interactive.list_reply.id, from, message.id)
          break;
        case "button_reply":
          await onScamAssessmentReply(db, interactive.button_reply.id, from, message.id);
          break;
      }
      break;

    case "text":
      // handle URL evidence here
      break;
  }
  markWhatsappMessageAsRead("factChecker", message.id);
}

exports.checkerHandlerTelegram = async function (message) {
  const from = message.from.id
  const db = admin.firestore();
}


async function onFactCheckerYes(messageId, from, platform = "whatsapp") {
  const db = admin.firestore();
  const messageRef = db.collection("messages").doc(messageId);
  const messageSnap = await messageRef.get();
  const message = messageSnap.data();
  const voteRequestSnap = await messageRef.collection("voteRequests").where("platformId", "==", from).where("platform", "==", platform).get();
  if (voteRequestSnap.empty) {
    functions.logger.log(`No corresponding voteRequest for message ${messageId} with platformId ${from} found`);
  } else {
    if (voteRequestSnap.size > 1) {
      functions.logger.log(`More than 1 voteRequest with platformId ${from} found`);
    }
    switch (message.type) {
      case "text":
        res = await sendTextMessage("factChecker", from, message.text, null, platform);
        break;
      case "image":
        const temporaryUrl = await getSignedUrl(message.storageUrl);
        functions.logger.log(temporaryUrl);
        res = await sendImageMessage("factChecker", from, temporaryUrl, message.text, null, platform);
        break;
    }
    functions.logger.log(JSON.stringify(res.data, null, 2));
    voteRequestSnap.docs[0].ref.update({
      hasAgreed: true,
      sentMessageId: res.data.messages[0].id,
    })
    setTimeout(() => {
      sendScamAssessmentMessage(voteRequestSnap.docs[0], messageRef, res.data.messages[0].id)
    }, 2000);
  }
}

async function onScamAssessmentReply(db, buttonId, from, replyId, platform = "whatsapp") {
  const responses = await getReponsesObj("factCheckers");
  const [messageId, voteRequestId, type] = buttonId.split("_");
  const voteRequestRef = db.collection("messages").doc(messageId).collection("voteRequests").doc(voteRequestId);
  const updateObj = {}
  if (type === "scam") {
    updateObj.isScam = true;
    updateObj.vote = "scam";
    sendWhatsappTextMessage("factChecker", from, responses.RESPONSE_RECORDED, replyId);
  } else if (type === "notscam") {
    updateObj.isScam = false;
    updateObj.vote = null;
    sendWhatsappTextMessage("factChecker", from, responses.HOLD_FOR_NEXT_POLL, replyId);
  }
  await voteRequestRef.update(updateObj);
}

async function onVoteReceipt(db, listId, from, replyId, platform = "whatsapp") {
  const responses = await getReponsesObj("factCheckers");
  const [messageId, voteRequestId, vote] = listId.split("_");
  const voteRequestRef = db.collection("messages").doc(messageId).collection("voteRequests").doc(voteRequestId);
  await voteRequestRef.update({
    vote: vote,
  })
  sendWhatsappTextMessage("factChecker", from, responses.RESPONSE_RECORDED, replyId);
}
