// Fixture for testing .tsx file support
import React from "react";

function Button({ onClick }: { onClick: () => void }) {
  console.log("Button rendered");
  return <button onClick={onClick}>Click me</button>;
}

export default Button;
