// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract OutcomeShare is ERC20, Ownable {
    error NonTransferable();
    error NotAuthorized();

    mapping(address => bool) private _transferAgents;

    constructor(string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_) {
        _transferOwnership(owner_);
    }

    function mint(address to, uint256 amt) external onlyOwner {
        _mint(to, amt);
    }

    function burn(address from, uint256 amt) external onlyOwner {
        _burn(from, amt);
    }

    // Block transfers/approvals so these behave like non-transferable receipts
    function _update(address from, address to, uint256 value) internal override {
        // allow mints/burns (one side is address(0)) or approved transfer agents
        if (from != address(0) && to != address(0) && !_transferAgents[_msgSender()]) {
            revert NonTransferable();
        }
        super._update(from, to, value);
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function setTransferAgent(address agent, bool allowed) external onlyOwner {
        _transferAgents[agent] = allowed;
    }

    function transferAuthorized(address from, address to, uint256 value) external {
        if (!_transferAgents[_msgSender()]) revert NotAuthorized();
        _transfer(from, to, value);
    }
}
