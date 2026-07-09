import "../styles/Game.css";
import Title from "./common/Title";
import SmallTitle from "./common/SmallTitle";
import HorizontalLine from "./common/HorizontalLine";
import Actions from "./display/Actions";
import Paragraphs from "./display/Paragraphs";
import Terminal from "./display/Terminal";
import DebugHelp from "./debug/DebugHelp";
import DebugStats from "./debug/DebugStats";
import useGameLogic from "../hooks/useGameLogic";
import useDebugCmds from "../hooks/useDebugCmds";

const Game = () => {
  const { debugHelp, debugMode } = useDebugCmds();
  const { gameRef, scene, flags, availableActions, actionClick, isLoading } =
    useGameLogic();

  return (
    <div className="game" ref={gameRef} tabIndex="0">
      <Terminal>
        {isLoading ? (
          <div className="loading-message">Loading...</div>
        ) : (
          <>
            <Title title={scene?.name} />
            <HorizontalLine />
            <Paragraphs flags={flags} paragraphs={scene?.paragraphs} />
            <HorizontalLine />
            {scene?.actions.length > 0 && <SmallTitle title="Actions:" />}
            <Actions actions={availableActions} onActionClick={actionClick} />
            {debugHelp && <DebugHelp />}
            {debugMode && <DebugStats flags={flags} />}
          </>
        )}
      </Terminal>
    </div>
  );
};

export default Game;
