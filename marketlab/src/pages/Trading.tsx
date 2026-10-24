import React from "react";

const Trading: React.FC = () => {
  return React.createElement(
    "div",
    { className: "p-4 md:p-6" },
    React.createElement("h1", { className: "text-3xl font-bold" }, "Trading"),
    React.createElement("p", { className: "text-gray-400" }, "Paper trading page")
  );
};

export default Trading;