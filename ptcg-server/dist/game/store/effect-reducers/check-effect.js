import { GameError } from '../../game-error';
import { GameLog, GameMessage } from '../../game-message';
import { PlayerType, SlotType } from '../actions/play-card-action';
import { EnergyCard } from '../card/energy-card';
import { CheckHpEffect, CheckProvidedEnergyEffect, CheckTableStateEffect } from '../effects/check-effects';
import { KnockOutEffect } from '../effects/game-effects';
import { TAKE_SPECIFIC_PRIZES } from '../prefabs/prefabs';
import { ChoosePokemonPrompt } from '../prompts/choose-pokemon-prompt';
import { ChoosePrizePrompt } from '../prompts/choose-prize-prompt';
import { CoinFlipPrompt } from '../prompts/coin-flip-prompt';
import { ShuffleDeckPrompt } from '../prompts/shuffle-prompt';
import { setupGame } from '../reducers/setup-reducer';
import { PokemonCardList } from '../state/pokemon-card-list';
import { GamePhase, GameWinner } from '../state/state';
function findKoPokemons(store, state) {
    const pokemons = [];
    for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i];
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
            const checkHpEffect = new CheckHpEffect(player, cardList);
            store.reduceEffect(state, checkHpEffect);
            if (cardList.damage >= checkHpEffect.hp) {
                pokemons.push({ playerNum: i, cardList });
            }
        });
    }
    return pokemons;
}
//New, Optimized Code ^^ Test Old Code CPU Usage First
// function findKoPokemons(store: StoreLike, state: State): PokemonItem[] {
//   return state.players.reduce((koPokemons: PokemonItem[], player, playerNum) => {
//     player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cardList, card, target) => {
//       const checkHpEffect = new CheckHpEffect(player, cardList);
//       store.reduceEffect(state, checkHpEffect);
//       if (cardList.damage >= checkHpEffect.hp) {
//         koPokemons.push({ playerNum, cardList });
//       }
//     });
//     return koPokemons;
//   }, []);
// }
function handleBenchSizeChange(store, state, benchSizes) {
    state.players.forEach((player, index) => {
        const benchSize = benchSizes[index];
        // Add empty slots if bench is smaller
        while (player.bench.length < benchSize) {
            const bench = new PokemonCardList();
            bench.isPublic = true;
            player.bench.push(bench);
        }
        if (player.bench.length === benchSize) {
            return;
        }
        // Remove empty slots, starting from the right side
        const empty = [];
        for (let index = player.bench.length - 1; index >= 0; index--) {
            const bench = player.bench[index];
            const isEmpty = bench.cards.length === 0;
            if (player.bench.length - empty.length > benchSize && isEmpty) {
                empty.push(bench);
            }
        }
        if (player.bench.length - empty.length <= benchSize) {
            // Discarding empty slots is enough
            for (let i = player.bench.length - 1; i >= 0; i--) {
                if (empty.includes(player.bench[i])) {
                    player.bench.splice(i, 1);
                }
            }
            return;
        }
        // Player has more Pokemons than bench size, discard some
        const count = player.bench.length - empty.length - benchSize;
        store.prompt(state, new ChoosePokemonPrompt(player.id, GameMessage.CHOOSE_POKEMON_TO_DISCARD, PlayerType.BOTTOM_PLAYER, [SlotType.BENCH], { min: count, max: count, allowCancel: false }), results => {
            results = results || [];
            const selected = [...empty, ...results];
            // Discard all empty slots and selected Pokemons
            for (let i = player.bench.length - 1; i >= 0; i--) {
                if (selected.includes(player.bench[i])) {
                    player.bench[i].moveTo(player.discard);
                    player.bench.splice(i, 1);
                }
            }
        });
    });
    return state;
}
function chooseActivePokemons(state) {
    const prompts = [];
    for (const player of state.players) {
        const hasActive = player.active.cards.length > 0;
        const hasBenched = player.bench.some(bench => bench.cards.length > 0);
        if (!hasActive && hasBenched) {
            const choose = new ChoosePokemonPrompt(player.id, GameMessage.CHOOSE_NEW_ACTIVE_POKEMON, PlayerType.BOTTOM_PLAYER, [SlotType.BENCH], { min: 1, allowCancel: false });
            prompts.push(choose);
        }
    }
    return prompts;
}
function choosePrizeCards(store, state, prizeGroups) {
    const prompts = [];
    for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i];
        for (const group of prizeGroups[i]) {
            const prizeLeft = player.getPrizeLeft();
            // In sudden death, taking any prize card means winning
            if (group.count > 0 && state.isSuddenDeath) {
                endGame(store, state, i === 0 ? GameWinner.PLAYER_1 : GameWinner.PLAYER_2);
                return [];
            }
            if (group.count > prizeLeft) {
                group.count = prizeLeft;
            }
            if (group.count > 0) {
                let message = GameMessage.CHOOSE_PRIZE_CARD;
                // Choose a custom message based on the destination.
                if (group.destination === player.discard) {
                    message = GameMessage.CHOOSE_PRIZE_CARD_TO_DISCARD;
                }
                const prompt = new ChoosePrizePrompt(player.id, message, {
                    isSecret: player.prizes[0].isSecret,
                    count: group.count,
                    destination: group.destination
                });
                prompts.push(prompt);
            }
        }
    }
    return prompts;
}
// function choosePrizeCards(state: State, prizesToTake: [number, number]): ChooseCardsPrompt[] {
//   const prompts: ChooseCardsPrompt[] = [];
//   for (let i = 0; i < state.players.length; i++) {
//     const player = state.players[i];
//     const prizeLeft = player.getPrizeLeft();
//     if (prizesToTake[i] > prizeLeft) {
//       prizesToTake[i] = prizeLeft;
//     }
//     if (prizesToTake[i] > 0) {
//       const allPrizeCards = new CardList();
//       // allPrizeCards.isSecret = true;  // Set the CardList as secret
//       // allPrizeCards.isPublic = false;
//       // allPrizeCards.faceUpPrize = false;
//       player.prizes.forEach(prizeList => {
//         allPrizeCards.cards.push(...prizeList.cards);
//       });
//       const prompt = new ChooseCardsPrompt(
//         player,
//         GameMessage.CHOOSE_PRIZE_CARD,
//         allPrizeCards,
//         {},  // No specific filter needed for prizes
//         { min: prizesToTake[i], max: prizesToTake[i], isSecret: player.prizes[0].isSecret, allowCancel: false }
//       );
//       prompts.push(prompt);
//     }
//   }
//   return prompts;
// }
export function endGame(store, state, winner) {
    if (state.players.length !== 2) {
        return state;
    }
    if ([
        GamePhase.WAITING_FOR_PLAYERS,
        GamePhase.PLAYER_TURN,
        GamePhase.ATTACK,
        GamePhase.BETWEEN_TURNS
    ].includes(state.phase) === false) {
        return state;
    }
    switch (winner) {
        case GameWinner.NONE:
            store.log(state, GameLog.LOG_GAME_FINISHED);
            break;
        case GameWinner.DRAW:
            store.log(state, GameLog.LOG_GAME_FINISHED_DRAW);
            break;
        case GameWinner.PLAYER_1:
        case GameWinner.PLAYER_2: {
            const winnerName = winner === GameWinner.PLAYER_1
                ? state.players[0].name
                : state.players[1].name;
            store.log(state, GameLog.LOG_GAME_FINISHED_WINNER, { name: winnerName });
            break;
        }
    }
    state.winner = winner;
    state.phase = GamePhase.FINISHED;
    return state;
}
export function checkWinner(store, state, onComplete) {
    const points = [0, 0];
    const reasons = [[], []];
    for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i];
        // Check for no active Pokemon
        if (player.active.cards.length === 0) {
            store.log(state, GameLog.LOG_PLAYER_NO_ACTIVE_POKEMON, { name: player.name });
            points[i === 0 ? 1 : 0]++;
            reasons[i === 0 ? 1 : 0].push('no_active');
        }
        if (player.prizes.every(p => p.cards.length === 0)) {
            store.log(state, GameLog.LOG_PLAYER_NO_PRIZE_CARD, { name: player.name });
            points[i]++;
            reasons[i].push('no_prizes');
        }
    }
    // Check for Sudden Death condition
    if (points[0] > 0 && points[1] > 0) {
        return initiateSuddenDeath(store, state);
    }
    if (points[0] + points[1] === 0) {
        if (onComplete) {
            onComplete();
        }
        return state;
    }
    let winner = GameWinner.DRAW;
    if (points[0] > points[1]) {
        winner = GameWinner.PLAYER_1;
    }
    else if (points[1] > points[0]) {
        winner = GameWinner.PLAYER_2;
    }
    state = endGame(store, state, winner);
    if (onComplete) {
        onComplete();
    }
    return state;
}
function initiateSuddenDeath(store, state) {
    store.log(state, GameLog.LOG_SUDDEN_DEATH);
    // Reset decks
    state.players.forEach(player => {
        // Collect all cards back to deck including stadium, lost zone and any other zones
        [player.active, ...player.bench, player.discard, ...player.prizes, player.hand, player.lostzone, player.stadium]
            .forEach(cardList => cardList.moveTo(player.deck));
        // Reset VSTAR and GX markers
        player.usedGX = false;
        player.usedVSTAR = false;
        // Shuffle deck
        return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
            player.deck.applyOrder(order);
        });
    });
    // Coin flip for first player
    return store.prompt(state, new CoinFlipPrompt(state.players[0].id, GameMessage.SETUP_WHO_BEGINS_FLIP), result => {
        const firstPlayer = result ? 0 : 1;
        setupSuddenDeathGame(store, state, firstPlayer);
    });
}
function setupSuddenDeathGame(store, state, firstPlayer) {
    state.activePlayer = firstPlayer;
    state.turn = 0;
    state.phase = GamePhase.SETUP;
    state.isSuddenDeath = true;
    const generator = setupGame(() => generator.next(), store, state);
    return generator.next().value;
}
function handlePrompts(store, state, prompts, onComplete) {
    const prompt = prompts.shift();
    if (prompt === undefined) {
        onComplete();
        return state;
    }
    const player = state.players.find(p => p.id === prompt.playerId);
    if (player === undefined) {
        throw new GameError(GameMessage.ILLEGAL_ACTION);
    }
    return store.prompt(state, prompt, (result) => {
        if (prompt instanceof ChoosePrizePrompt) {
            const destination = prompt.options.destination || player.hand;
            TAKE_SPECIFIC_PRIZES(store, state, player, result, { destination });
            handlePrompts(store, state, prompts, onComplete);
        }
        else if (prompt instanceof ChoosePokemonPrompt) {
            const selectedPokemon = result;
            if (selectedPokemon.length !== 1) {
                throw new GameError(GameMessage.ILLEGAL_ACTION);
            }
            const benchIndex = player.bench.indexOf(selectedPokemon[0]);
            if (benchIndex === -1 || player.active.cards.length > 0) {
                throw new GameError(GameMessage.ILLEGAL_ACTION);
            }
            const temp = player.active;
            const playerActive = player.active.getPokemonCard();
            player.active = player.bench[benchIndex];
            if (playerActive) {
                playerActive.movedToActiveThisTurn = true;
            }
            player.bench[benchIndex] = temp;
            handlePrompts(store, state, prompts, onComplete);
        }
    });
}
export function* executeCheckState(next, store, state, onComplete) {
    // Instead of a simple array of numbers per player, we build an array of PrizeGroup arrays.
    // This is necessary because for some effects (e.g. Billowing Smoke) we need to differentiate how many prizes
    // are related to each Knock Out in order, for example, to preemptively determine their destination
    const prizeGroups = state.players.map(() => []);
    // This effect checks the general data from the table (bench size)
    const checkTableStateEffect = new CheckTableStateEffect([5, 5]);
    store.reduceEffect(state, checkTableStateEffect);
    handleBenchSizeChange(store, state, checkTableStateEffect.benchSizes);
    if (store.hasPrompts()) {
        yield store.waitPrompt(state, () => next());
    }
    const pokemonsToDiscard = findKoPokemons(store, state);
    for (const pokemonToDiscard of pokemonsToDiscard) {
        const owner = state.players[pokemonToDiscard.playerNum];
        const knockOutEffect = new KnockOutEffect(owner, pokemonToDiscard.cardList);
        state = store.reduceEffect(state, knockOutEffect);
        if (store.hasPrompts()) {
            yield store.waitPrompt(state, () => next());
        }
        if (knockOutEffect.preventDefault === false) {
            // Prizes go to the opponent of the knocked out Pokemon.
            const opponentIndex = pokemonToDiscard.playerNum === 0 ? 1 : 0;
            // Default destination is the opponent's hand.
            const defaultDestination = state.players[opponentIndex].hand;
            // If the knockout effect has a custom prize destination, use it; otherwise default.
            const destination = knockOutEffect.prizeDestination || defaultDestination;
            // Try to merge prize groups that share the same destination.
            let group = prizeGroups[opponentIndex].find(g => g.destination === destination);
            if (!group) {
                group = { destination, count: 0 };
                prizeGroups[opponentIndex].push(group);
            }
            group.count += knockOutEffect.prizeCount;
        }
    }
    const prompts = [
        ...choosePrizeCards(store, state, prizeGroups),
        ...chooseActivePokemons(state)
    ];
    const completed = state.players.map(() => false);
    for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i];
        const playerPrompts = prompts.filter(p => p.playerId === player.id);
        state = handlePrompts(store, state, playerPrompts, () => {
            completed[i] = true;
            if (completed.every(c => c)) {
                checkWinner(store, state, onComplete);
            }
        });
    }
    return state;
}
export function checkState(store, state, onComplete) {
    if ([GamePhase.PLAYER_TURN, GamePhase.ATTACK, GamePhase.BETWEEN_TURNS].includes(state.phase) === false) {
        if (onComplete !== undefined) {
            onComplete();
        }
        return state;
    }
    const generator = executeCheckState(() => generator.next(), store, state, onComplete);
    return generator.next().value;
}
export function checkStateReducer(store, state, effect) {
    if (effect instanceof CheckProvidedEnergyEffect) {
        effect.source.cards.forEach(c => {
            if (c instanceof EnergyCard && !effect.energyMap.some(e => e.card === c)) {
                effect.energyMap.push({ card: c, provides: c.provides });
            }
        });
        return state;
    }
    return state;
}
