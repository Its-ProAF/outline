"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        "passwords",
        "category",
        {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: "password",
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "passwords",
        ["teamId", "category", "createdAt", "id"],
        { transaction }
      );
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("passwords", "category");
  },
};
